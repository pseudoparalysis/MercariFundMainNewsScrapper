/*
	Scraps news from TheFly.
	Implemented using Puppeteer.
    Make sure firebase admin is initialized before this file runs.
*/

const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
let browserInstance = null;
let mainPage = null;

const https = require("https");
const admin = require("firebase-admin")

//Uncomment and change the serviceAccount path to run this script as a standalone
// const serviceAccount = require("../config/your-firebase-auth-file.json");

// admin.initializeApp({
// 	credential: admin.credential.cert(serviceAccount)
// });

const theFlyCompanyDataDb = admin.firestore().collection("TheFlyCompanyData");
const theFlyIndexCompaniesDb = admin.firestore().collection("TheFlyIndexCompaniesData");
const theFlyLastReadNewsDb = admin.firestore().doc("TheFlyState/ScrapState");
const theFlyTimeInfoDb = admin.firestore().doc("TheFlyState/TimeInfo");
const telegramChatIdsDb = admin.firestore().doc("TheFlyDestination/Telegram");
const discordChannelWebhooksDb = admin.firestore().doc("TheFlyDestination/Discord");


const theFlyAuthInfo = require("../config/theFlyAuth.json");
const telegramToken = require("../config/telegramAuthInfo.json")["token"];

let companyDataCache = {};
let lastNewsReadInfo = {};
let telegramChatIds = [];
let discordChannelWebhooks = [];
let discordChannels = {};
let newsScanInterval = null;
let theFlyTimeOffset = null;

//Change this to account for different time zones.
const DEFAULT_THE_FLY_TIME_OFFSET = -4;

const tickersToLookoutFor = [
	"SPG",
	"PFE",
	"MRNA",
	"NVAX",
	"EXPE",
	"BABA",
	"BA",
	"CCL",
	"AAL",
	"RF",
	"SIVB",
	"KEY",
	"CFG",
	"FITB",
	"PNC",
	"TFC",
	"MTB",
	"FRC",
	"CIT",
	"FHN",
	"CMA",
	"ZION",
	"PCBT",
	"LYFT",
    "AAPL",
    "MSFT",
    "AMZN",
    "GOOG",
    "GOOGL",
    "FB",
    "TSLA",
    "NVDA",
    "PYPL",
    "CMCSA",
    "ADBE",
    "NFLX",
    "INTC",
    "PEP",
    "ASML",
    "CSCO",
    "QCOM",
    "AVGO",
    "TMUS",
    "COST",
    "TXN",
    "CHTR",
    "AMGN",
    "SBUX",
    "ZM",
    "AMD",
    "JD",
    "PDD",
    "ISRG",
    "INTU",
    "BKNG",
    "MDLZ",
    "AMAT",
    "MU",
    "MELI",
    "FISV",
    "GILD",
    "ADP",
    "LRCX",
    "CSX",
    "ATVI",
    "MRNA",
    "ADSK",
    "NTES",
    "VRTX",
    "WDAY",
    "ADI",
    "REGN",
    "ILMN",
    "LULU",
    "NXPI",
    "MNST",
    "DOCU",
    "MAR",
    "CTSH",
    "KLAC",
    "KHC",
    "ALGN",
    "ROST",
    "EXC",
    "BIDU",
    "IDXX",
    "EA",
    "MCHP",
    "BIIB",
    "CTAS",
    "WBA",
    "SNPS",
    "XLNX",
    "XEL",
    "EBAY",
    "PAYX",
    "CDNS",
    "ORLY",
    "DXCM",
    "SGEN",
    "VRSK",
    "PCAR",
    "ANSS",
    "FAST",
    "SIRI",
    "CPRT",
    "DLTR",
    "ALXN",
    "SWKS",
    "SPLK",
    "VRSN",
    "MXIM",
    "CERN",
    "TTWO",
    "TCOM",
    "CDW",
    "INCY",
    "EXPE",
    "FOXA",
    "FOX",
    "CHKP",
    "CTXS",
    "WDC",
    "ULTA",
    "LBTYA",
    "BMRN",
    "LBTYK",
    "AAPL",
    "MSFT",
    "AMZN",
    "GOOG",
    "GOOGL",
    "FB",
    "BRK.B",
    "V",
    "WMT",
    "JNJ",
    "JPM",
    "PG",
    "MA",
    "NVDA",
    "UNH",
    "HD",
    "DIS",
    "PYPL",
    "VZ",
    "BAC",
    "CMCSA",
    "ADBE",
    "PFE",
    "NFLX",
    "KO",
    "NKE",
    "T",
    "MRK",
    "CRM",
    "INTC",
    "PEP",
    "ABT",
    "TMO",
    "CSCO",
    "ABBV",
    "ORCL",
    "QCOM",
    "CVX",
    "XOM",
    "AVGO",
    "TMUS",
    "COST",
    "DHR",
    "ACN",
    "MCD",
    "TXN",
    "MDT",
    "HON",
    "UPS",
    "NEE",
    "LLY",
    "BMY",
    "UNP",
    "CHTR",
    "BA",
    "AMGN",
    "LIN",
    "PM",
    "WFC",
    "C",
    "SBUX",
    "AMD",
    "LOW",
    "IBM",
    "RTX",
    "BLK",
    "NOW",
    "AMT",
    "MS",
    "LMT",
    "AXP",
    "ISRG",
    "MMM",
    "INTU",
    "CAT",
    "CVS",
    "GE",
    "FIS",
    "SCHW",
    "SYK",
    "EL",
    "BKNG",
    "TGT",
    "MDLZ",
    "GS",
    "AMAT",
    "SPGI",
    "MU",
    "ANTM",
    "TJX",
    "DE",
    "CI",
    "FISV",
    "FDX",
    "MO",
    "GILD",
    "ZTS",
    "ADP",
    "PLD",
    "LRCX",
    "CL",
    "CCI",
    "CSX",
    "CB",
    "BDX",
    "DUK",
    "USB",
    "CME",
    "SO",
    "TFC",
    "SHW",
    "ITW",
    "ATVI",
    "ECL",
    "GM",
    "EQIX",
    "D",
    "ICE",
    "ADSK",
    "NSC",
    "PNC",
    "GPN",
    "APD",
    "VRTX",
    "MMC",
    "EW",
    "HUM",
    "MCO",
    "ADI",
    "REGN",
    "PGR",
    "HCA",
    "DG",
    "NOC",
    "ILMN"

];

const storyTypeToIgnore = [
	"Conference/Events"
];


async function runApp() {
	await initApp();
	console.log("TheFlyScrapper Init Complete");

	browserInstance = await puppeteer.launch({ args: ['--no-sandbox'] });
	mainPage = await browserInstance.newPage();

	await loginToTheFly("https://thefly.com/news.php", navigateTo);

	//Start to scan for new news
	console.log("\nTheFlyScrapper: Start scanning for new news");

	let refreshCountdown = 5;
	const reLoginMaxCount = 4
	let reLoginCountdown = reLoginMaxCount;

	newsScanInterval = setInterval(async () => {
		const latestTableHtml = await getLatestNewsTableInfo();
		if(!latestTableHtml) {
			console.log("TheFlyScrapper: Today's table not found");
			return false;
		}

		const cheerioLatestTable = cheerio.load(latestTableHtml);
		const cheerioLatestTableRows = cheerioLatestTable("tr.tr_noticia");
		console.log("TheFlyScrapper: Today's table found");

		if(Object.keys(lastNewsReadInfo).length > 0) {
			await filterAndSendUpToLastReadNews(cheerioLatestTableRows, cheerioLatestTable, true);
		}

		if(cheerioLatestTableRows.length > 0) {
			console.log("TheFlyScrapper: Saved last read news information");

			for(let i = 0; i < cheerioLatestTableRows.length; i++) {
				const currRow = cheerioLatestTable(cheerioLatestTableRows[i]);
                //Make sure that the current time is later than the time of the news
				if(parseInt(currRow.attr("data-datetime")) <= parseInt(getTheFlyDateTimeStringForNow())) {
					lastNewsReadInfo["id"] = currRow.attr("data-id");
					lastNewsReadInfo["datetime"] = currRow.attr("data-datetime");

					await storeLastNewsReadInfo(lastNewsReadInfo);
					break;
				}
			}
		}


		if(!(await isLoggedIn())) {
			reLoginCountdown -= 1;
			if(reLoginCountdown === 0) {

				reLoginCountdown = reLoginMaxCount;
				await loginToTheFly("https://thefly.com/news.php", navigateTo);
			}
		}


		if(refreshCountdown === 0) {
			console.log("TheFlyScrapper: Refreshing the page");

			//Randomise page refresh interval
			refreshCountdown = Math.floor(Math.random() * 6) + 5;
			await mainPage.reload({waitUntil: "networkidle0"});
		}
		refreshCountdown -= 1;
	}, 30000);
}

async function initApp() {

    //Load all necessary data
    await retrieveTheFlyTimeOffset();
    await retrieveLastNewsReadInfo();
    await retrieveTelegramChatIds();
    await retrieveDiscordChannelWebhooks();

}

async function filterAndSendUpToLastReadNews(cheerioTableRows, cheerioLatestTable, convertToCheerioRows = false) {
	const dtStringNow = getTheFlyDateTimeStringForNow();
	let newsDelayFactor = 0;
	for(let i = 0; i < cheerioTableRows.length; i++) {

		let cheerioRow = cheerioTableRows[i];
		if(convertToCheerioRows) {
			cheerioRow = cheerioLatestTable(cheerioRow);
		}

		const storyType = cheerioRow.find(".story_type").text().trim();
		const cheerioTickers = cheerioRow.find(".ticker.fpo_overlay");
		const newsDtString = cheerioRow.attr("data-datetime");
		let sendNews = false;

		if(cheerioRow.attr("data-id") !== lastNewsReadInfo["id"]) {
			if(parseInt(newsDtString) <= parseInt(dtStringNow)) {
				console.log("TheFlyScrapper: New news story type: " + storyType);
				if(!storyTypeToIgnore.includes(storyType)) {
					console.log("TheFlyScrapper: New news VALID story type");
					for(let j = 0; j < cheerioTickers.length; j++) {
						const cheerioTickerElement = cheerioLatestTable(cheerioTickers[j]);
						const tickerString = cheerioTickerElement.clone().children().remove().end().text();

						console.log("TheFlyScrapper: New news ticker: " + tickerString);

						if(!companyDataCache.hasOwnProperty(tickerString)) {
							await retrieveCompanyData(tickerString);
						}

						const companyInfo = companyDataCache[tickerString];

						if(tickersToLookoutFor.includes(tickerString)) {
							console.log("TheFlyScrapper: New news VALID ticker");
							sendNews = true;
		                    //Do not break the loop after decision to send news is made.
                            //Each news can have multiple tickers
                            //Loop through the rest of the tickers to allow caching of company data
						}

						if(!companyInfo) {
							continue;
						}
					}
				} 

				if(sendNews) {
					newsDelayFactor += 1;
					console.log("TheFlyScrapper: Sending news (Index: " + i + ")\n");
					setTimeout(function(newsRowToSendOut, index) {
						sendNewsMessageOut(newsRowToSendOut, cheerioLatestTable);
						console.log("TheFlyScrapper: News sent (Index: " + index + ")\n");
					}, 4000*newsDelayFactor, cheerioRow, i);
				}
			}

		} else {
			console.log("TheFlyScrapper: Reached last read news");
			return false; 
		}
	}
	
}


function sendNewsMessageOut(cheerioNewsRow, cheerioLatestTable) {
	
	const tickers = [];
    const textChunkLengthLimit = 1600;

	cheerioNewsRow.find(".ticker.fpo_overlay").each(function(index, tickerElement) {
		const cheerioTickerElement = cheerioLatestTable(tickerElement);
		const tickerString = cheerioTickerElement.clone().children().remove().end().text();
		let indicesInfo = [];
		if(companyDataCache.hasOwnProperty(tickerString)) {
			if(companyDataCache[tickerString].hasOwnProperty("Indices")) {
				indicesInfo = companyDataCache[tickerString]["Indices"];
				tickers.push(tickerString + " (" + indicesInfo.join(", ") + ")");
			} else {
				tickers.push(tickerString);
			}
		} else {
			tickers.push(tickerString);
		}
		
	});

	const fullTickerString = tickers.join(", ");
	const storyType = cheerioNewsRow.find(".story_type").text().trim();
	const newsTitle = cheerioNewsRow.find(".newsTitleLink").text();
	const newsUrl = cheerioNewsRow.find(".newsTitleLink").attr("href");
	const newsContent = cheerioNewsRow.find(".completeText").text();
	const sentences = newsContent.split(". ");
	let temp = [];
	const msgParts = [];

	let charCount = 0;

	for(let j = 0; j < sentences.length; j++) {
		charCount += sentences[j].length;

		if(charCount < textChunkLengthLimit) {
			temp.push(sentences[j]);
		} else {
			charCount = sentences[j].length;
			msgParts.push(temp.join(". ") + ". ");
			temp = [];
			temp.push(sentences[j]);
		}
	}
	
	//Push the remaining part of the message
	msgParts.push(temp.join(". "));


	if(storyType === "On The Fly") {
		//This type of news does not show the full text
		msgParts[msgParts.length - 1] = msgParts[msgParts.length - 1] + "\n" + newsUrl;
	}

	let k = 0;
	const throttleInterval = setInterval(function() {
		if(k < msgParts.length) {

			let msg = "";
			if(k > 0) {
				msg = "**(CONTINUE " + k.toString() + ") " + newsTitle + "**\n" + fullTickerString + "\n\n" + msgParts[k];
			} else {
				msg = "**" + newsTitle + "**\n" + fullTickerString + "\n\n" + msgParts[k];
			}
			
			for(let i = 0; i < telegramChatIds.length; i++) {
				telegramApiRequest("sendMessage", {"chat_id": telegramChatIds[i], "text": msg, "disable_web_page_preview": true})
			}

			for(let j = 0; j < discordChannelWebhooks.length; j++) {
				sendDiscordWebhookMsg(discordChannelWebhooks[j], {"content": msg, "username": "The Fly Bot"});
			} 

			k++;
		} else {
			clearInterval(throttleInterval);
		}

	}, 200);
}

async function retrieveTheFlyTimeOffset() {
	const documentSnapshot = await theFlyTimeInfoDb.get();
	if(documentSnapshot.exists) {
		theFlyTimeOffset = documentSnapshot.data()["TimeOffset"];
		theFlyTimeOffset = theFlyTimeOffset ? theFlyTimeOffset : DEFAULT_THE_FLY_TIME_OFFSET;
	}
}

async function retrieveCompanyData(ticker) {
	const querySnapshot = await theFlyCompanyDataDb.where("Ticker", "==", ticker).limit(1).get();
	if(!querySnapshot.empty) {
		const companyData = querySnapshot.docs[0].data();
		if(companyData) {
			companyDataCache[ticker] = companyData;
		}
	}

	const querySnapshot2 = await theFlyIndexCompaniesDb.where("Ticker", "==", ticker).get();
	const tickerIndices = [];
	if(!querySnapshot2.empty) {
		for(let i = 0; i < querySnapshot2.docs.length; i++) {
			const tickerIndexInfo = querySnapshot2.docs[i].data();
			if(tickerIndexInfo) {
				tickerIndices.push(tickerIndexInfo["Index"]);
			}
		}
		if(companyDataCache.hasOwnProperty(ticker)) {
			companyDataCache[ticker]["Indices"] = tickerIndices;
		}
	}
}

async function retrieveLastNewsReadInfo() {
	const documentSnapshot = await theFlyLastReadNewsDb.get();
	if(documentSnapshot.exists) {
		lastNewsReadInfo = documentSnapshot.data()["lastNewsReadInfo"];
		lastNewsReadInfo = lastNewsReadInfo ? lastNewsReadInfo : {};
	}
}

async function retrieveTelegramChatIds() {
	const documentSnapshot = await telegramChatIdsDb.get();
	if(documentSnapshot.exists) {
		telegramChatIds = documentSnapshot.data()["chatIds"];
		telegramChatIds = telegramChatIds ? telegramChatIds : [];
	}
	
}

async function retrieveDiscordChannelWebhooks() {
	const documentSnapshot = await discordChannelWebhooksDb.get();
	if(documentSnapshot.exists) {
		discordChannelWebhooks = documentSnapshot.data()["channelWebhooks"];
		discordChannelWebhooks = discordChannelWebhooks ? discordChannelWebhooks : [];
	}
}

async function storeLastNewsReadInfo(newsDetails) {
	await theFlyLastReadNewsDb.set({"lastNewsReadInfo": newsDetails});
}

async function isLoggedIn() {
    //loggedin is a variable that is set in TheFly's page.
	return await mainPage.evaluate(() => {
		return loggedin ? true : false;
	});
}

async function loginToTheFly(redirectUrl, redirectCallback) {

	await mainPage.goto("https://thefly.com/", {waitUntil: "domcontentloaded"});
	console.log("TheFlyScrapper: Homepage done loading");
	await mainPage.evaluate((loginDetails) => {
		//loggedin is variable in broswer's scope
		if(!loggedin) {
			var loginForm = document.getElementById("login_form");
			var loginEmailField = document.getElementById("username");
			var passwordField = document.getElementById("password");

			loginEmailField.value = loginDetails["username"];
			passwordField.value = loginDetails["password"];
			loginForm.submit();
		}
	}, theFlyAuthInfo);

	console.log("TheFlyScrapper: Logged into TheFly");
	await mainPage.waitForNavigation({waitUntil: "networkidle0"});
	await redirectCallback(redirectUrl);
	console.log("TheFlyScrapper: Navigated to Breaking News Page");
}

async function getLatestNewsTableInfo() {
	return await mainPage.evaluate(() => {
		var latestNewsTableDOM = document.querySelector(".news_table.today.first_table");
		var latestNewsTable = null;

		if(latestNewsTableDOM) {
			latestNewsTable = latestNewsTableDOM.outerHTML;
		}

		return latestNewsTable;
	});
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

function telegramApiRequest(method, data) {
	const options = {
	 	"headers": {
	 		"Content-Type": "application/json"
	 	}
	};
	const payload = JSON.stringify(data);
	
	httpsPostReq('https://api.telegram.org/bot' + telegramToken + '/' + method, payload, options, function() {
		return true;
	});
	  
	return false;
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

function getTheFlyDateTimeStringForNow() {
	const dateNow = getTimeByOffset(theFlyTimeOffset);
	let yearNow = dateNow.getFullYear().toString();

	let monthNow = padZero(dateNow.getMonth() + 1, 2);
	let dateNumNow = padZero(dateNow.getDate(), 2);
	let hoursNow = padZero(dateNow.getHours(), 2);
	let minutesNow = padZero(dateNow.getMinutes(), 2);
	let secondsNow = padZero(dateNow.getSeconds(), 2);


	return yearNow + monthNow + dateNumNow + hoursNow + minutesNow + secondsNow;

}

function getTimeByOffset(offset) {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const nd = new Date(utc + (3600000*offset));

    return nd;

}

function padZero(number, targetLength) {
	let zerosToAdd = "";
	number = parseFloat(number);
	if(number > 0) {
		for(let i = targetLength - 1; i >= 0; i--) {
			if(number >= Math.pow(10, i)) {
				break;
			}
			zerosToAdd += "0";
		}
	} else if(number === 0) {
		for(let i = 0; i < targetLength - 1; i++) {
			zerosToAdd += "0";
		}
	}

	return zerosToAdd + number.toString();
}

async function navigateTo(destination) {
    if(!destination) {
        return false;
    }

    await mainPage.goto(destination, {waitUntil: "networkidle0"});
}


module.exports = {
	runApp: runApp
}