/*
	Scraps news from Oanda Dow Jones news.
	The APIs to login and get the news are obtained by looking at the to the http requests through developer console.
    Make sure firebase admin is initialized before this file runs.
*/

const cheerio = require("cheerio");

//Make sure firebase admin is initialized before this file runs
const admin = require("firebase-admin");
const https = require("https");

//Uncomment and change the serviceAccount path to run this script as a standalone

// const serviceAccount = require("../config/your-firebase-auth-file.json");
// admin.initializeApp({
// 	credential: admin.credential.cert(serviceAccount)
// });


const oandaNewsAuthInfo = require("../config/oandaNewsAuthInfo.json");
const oandaNewsDiscordDestDb = admin.firestore().doc("OandaNewsDestination/Discord");

const titlesNotToSend = [
	"Interbank Foreign Exchange Rates",
	"Late Spot Sterling Rates",
	"ECB Foreign Exchange Reference Rates"
];

let oandaDiscordChannelWebhooks = [];
let oandaNewsSeqNum = 0;
let oandaNewsSSOToken = "";

let newsIsSending = false;

//The API of oanda news page is not perfect, sometimes recent news might repeat
//This cache will store the ids of the news that are checked and prevent duplicated news to be sent.
const listOfSentNewsIds = [];

async function runApp() {
  	await oandaNewsLogin();
  	
  	await retrieveOandaNewsDiscordWebhooks();

  	await scanForOandaNews();
  	setInterval(async () => {
  		console.log("OandaNewsScrapper: Token is " + oandaNewsSSOToken);
  		console.log("OandaNewsScrapper: MaxSeqNum is " + oandaNewsSeqNum.toString());
	  	await scanForOandaNews();
  	}, 45000);
}

async function oandaNewsLogin() {
	const timestamp = new Date().getTime().toString();
	const loginUrl = `https://fxgame-webapi.oanda.com/v1/user/login.json?api_key=d39400e6d2f3c11a&client_type=webgui&client_version=0.0.0&password=${oandaNewsAuthInfo["password"]}&username=${oandaNewsAuthInfo["username"]}&_=${timestamp}`;
	let res = await awaitableHttpsGetReq(encodeURI(loginUrl),{});
	res = cleanJson(res);
	try {
		const parsedJsonRes = JSON.parse(res);
		if(parsedJsonRes["session_token"]) {
			oandaNewsSSOToken = parsedJsonRes["session_token"];
			console.log("OandaNewsScrapper: Logged in");
		}
	} catch(err) {
		console.log("OandaNewsScrapper: Login Failed");
		console.log(err);
	}

}

async function scanForOandaNews() {
	console.log("OandaNewsScrapper: Scanning for news...");
	let oandaNewsSent = false;

	if(oandaNewsSeqNum === 0) {
		await getMaxSeqNum();
		console.log("OandaNewsScrapper MaxSeqNum: " + oandaNewsSeqNum);
	} else {
		await getAndSendLatestNews();
	}

}

async function getMaxSeqNum() {
	let res = await awaitableHttpsGetReq(`https://fxgame-webapi.oanda.com/v1/news/list.json?session_token=${oandaNewsSSOToken}&language=ENG&max_count=0`, {});
	res = cleanJson(res);
	try {
		const parsedJsonRes = JSON.parse(res);
		if(parsedJsonRes["Result"] === true) {
			oandaNewsSeqNum = parsedJsonRes["MaxSeqNum"];
		}
	} catch(err) {
		console.log(err);
	}
}

async function getAndSendLatestNews() {
	let res = await awaitableHttpsGetReq(`https://fxgame-webapi.oanda.com/v1/news/list.json?session_token=${oandaNewsSSOToken}&language=ENG&max_count=200&seqNum=${oandaNewsSeqNum.toString()}`, {});
	res = cleanJson(res);
	try {
		const parsedJsonRes = JSON.parse(res);
	
		if(parsedJsonRes["Result"] === true) {
			oandaNewsSeqNum = parsedJsonRes["MaxSeqNum"];
			const newsList = parsedJsonRes["NewsList"];

			for(let i = newsList.length - 1; i >= 0; i--) {
				while(newsIsSending) {
					await sleep(100);
				}

				const currNewsMetaData = newsList[i];

				const currNewsId = currNewsMetaData["Uid"];
				const currNewsSource = currNewsMetaData["Source"];
				const articleTitle = currNewsMetaData["Headline"];


				if(!isTitleAllowed(articleTitle)) {
					continue;
				}

				if(!currNewsSource.toLowerCase().includes("dow jones")) {
					continue;
				}

				if(listOfSentNewsIds.indexOf(currNewsId) !== -1) {
					continue;
				}

				const timestampNow = Math.floor(new Date().getTime() / 1000);
				const newsTimestamp = currNewsMetaData["Time"];
				if(Math.abs(timestampNow - newsTimestamp) > 3600) {
					continue;
				}


				const articleDetails = await getArticleDetails(currNewsId);

				if(articleDetails) {
					const textLines = getTextLinesFromArticle(articleDetails);
					console.log("OandaNewsScrapper: Sending '" + articleTitle + "'");
					sendNewsMessageOut(textLines);
					cacheReadNewsIds(currNewsId);
				}
				
			}
		}
		
	} catch(err) {
		console.log(err);
	}

}

async function getArticleDetails(newsId) {
	let res = await awaitableHttpsGetReq(`https://fxgame-webapi.oanda.com/v1/news/article.json?uid=${newsId.toString()}&session_token=${oandaNewsSSOToken}`, {});
	res = cleanJson(res);

	try {
		const parsedJsonRes = JSON.parse(res);
		if(parsedJsonRes["Result"] === true) {
			return parsedJsonRes["Article"];
		}

	} catch(err) {
		console.log(err);
	}
}

function getTextLinesFromArticle(articleDetails) {
	let title = articleDetails["Headline"];

	const textLines = [];

	if(title.indexOf("DJ ") === 0) {
		title = title.substring(3).trim();
	} else if(title.indexOf("*DJ ") === 0) {
		title = title.substring(4).trim();
	}

	textLines.push(title);

	const newsHtmlBody = articleDetails["Body"];
	const $ = cheerio.load(newsHtmlBody);

	$("body pre, body p").each((index, element) => {
		const cheerioElement = $(element);
		let lineText = cheerioElement.text();

		if(cheerioElement.is("p")) {
			lineText = lineText.trim("\n");
			lineText = lineText.trim();
			lineText = "\n" + lineText + "\n";
		}
		textLines.push(lineText);
	});


	return textLines;
}

function cacheReadNewsIds(newsId) {
	if(listOfSentNewsIds >= 30) {
		listOfSentNewsIds.shift();
	}
	listOfSentNewsIds.push(newsId);
}

function isTitleAllowed(articleTitle) {
  	for(let i = 0; i < titlesNotToSend.length; i++) {
  		if(articleTitle.toLowerCase().includes(titlesNotToSend[i].toLowerCase())) {
  			return false;
  		}
  	}
  	return true;
}

async function retrieveOandaNewsDiscordWebhooks() {
	const documentSnapshot = await oandaNewsDiscordDestDb.get();
	if(documentSnapshot.exists) {
		const discordWebhooks = documentSnapshot.data()["channelWebhooks"];
		oandaDiscordChannelWebhooks = discordWebhooks ? discordWebhooks : [];
	}
}

function sendNewsMessageOut(textLines) {
	newsIsSending = true;
	const textChunkLengthLimit = 1700;
	const title = textLines[0];
	const rawSentences = textLines.slice(1);
	let temp = [];
	const msgParts = [];

	let charCount = 0;
	let sentences = treatText(rawSentences, textChunkLengthLimit);
	for(let j = 0; j < sentences.length; j++) {

		charCount += sentences[j].length;
		if(charCount < textChunkLengthLimit) {
			temp.push(sentences[j]);
		} else {
			charCount = sentences[j].length;
			msgParts.push(temp.join(""));
			temp = [];
			temp.push(sentences[j]);
		}
	}
	
	//Push the remaining parts of the message
	msgParts.push(temp.join(""));

	//To only allow messages with title to be sent
	if(msgParts.length === 0) {
		msgParts.push("");
	}

	let k = 0;
	const throttleInterval = setInterval(function() {
		if(k < msgParts.length) {

			let msg = "";
			if(k > 0) {
				msg = "**(CONTINUE " + k.toString() + ") " + title + "**\n\n```" + msgParts[k] + "```";
			} else {
				msg = "**" + title + "**\n\n```" + msgParts[k] + "```";
			}
			
			for(let i = 0; i < oandaDiscordChannelWebhooks.length; i++) {
				sendDiscordWebhookMsg(oandaDiscordChannelWebhooks[i], {"content": msg, "username": "Oanda Dow Jones Newswires"});
			}

			k++;
		} else {
			newsIsSending = false;
			clearInterval(throttleInterval);
		}

	}, 500);
}



function httpsPostReq(url, payload, options, callback) {
	options.method = "POST";
	const req = https.request(url, options, res => {
		let returnData = "";
	  	res.on('data', d => {
  	  		returnData += d.toString();
	  	});

	  	res.on("end", () => {
	  		callback(returnData);
	  		returnData = null;
	  	});
	});

	req.on('error', error => {
  		console.error(error);
	});

	req.write(payload);
	req.end();
}

async function awaitableHttpsGetReq(url, options) {
	return new Promise((resolver, rejector) => {
		options.method = "GET";
		const req = https.request(url, options, res => {
			let returnData = "";
		  	res.on('data', d => {
	  	  		returnData += d.toString();
		  	});

		  	res.on("end", () => {
		  		resolver(returnData);
		  		returnData = null;
		  	});
		});

		req.on('error', error => {
	  		console.error(error);
		});

		req.end();
	});
}

function sendDiscordWebhookMsg(webhookUrl, data) {
	const options = {
	 	"headers": {
	 		"Content-Type": "application/json"
	 	}
	};
	const payload = JSON.stringify(data);
	
	httpsPostReq(webhookUrl, payload, options, function() {
		return true;
	});
	  
}

function treatText(lines, chunkLength) {
	let treatedText = [];

	for(let i = 0; i < lines.length; i++) {
		treatedText = treatedText.concat(cutLineUp(lines[i], chunkLength));
	}

	return treatedText;
}
function cutLineUp(line, chunkLength) {
	if(line.length < chunkLength) {
		return [line];
	}
	let cutUpLines = [];
	let splitedLines = [];
	//"||" is a dummy token to split
	//This way, the delimiter can be preserved
	if(line.includes("\n")) {
		line = line.replace("\n", "\n||");
	} else {
		line = line.replace(". ", ". ||")
	}
	splitedLines = line.split("||");
	for(let i = 0; i < splitedLines.length; i++) {
		cutUpLines = cutUpLines.concat(cutLineUp(splitedLines[i], chunkLength));
	}

	return cutUpLines;

}

function cleanJson(rawJson) {
	let cleanedJson = rawJson.replace(/(\n)/g, "\\n");
	cleanedJson = cleanedJson.replace(/(\r)/g, "\\r");
	cleanedJson = cleanedJson.replace(/(\r\n)/g, "\\r\\n");
	cleanedJson = cleanedJson.replace(/(\t)/g, "\\t");
	return cleanedJson;
}

function sleep(duration) {
	return new Promise((resolve, reject) => {setTimeout(resolve, duration)});
}

module.exports = {
	runApp: runApp
}