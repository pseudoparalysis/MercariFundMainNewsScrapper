/*
	Brought in from old project on adhoc basis
	Pulls in twitter feed.
*/
const https = require("https");
const admin = require('firebase-admin');


//Uncomment and change the serviceAccount path to run this script as a standalone

// const serviceAccount = require("../config/your-firebase-auth-file.json");
// admin.initializeApp({
// 	credential: admin.credential.cert(serviceAccount)
// });

const twitterLastTweetDb = admin.firestore().doc("TwitterFeedState/lastTweetIds");
const twitterFeedDiscordDestDb = admin.firestore().doc("TwitterFeedDestination/Discord");

//Credential generator
const authInfo = require("../config/twitterAuthInfo.json");
const basicAuthInfo = authInfo["apiKey"] + ":" + authInfo["apiKeySecret"];
const buff = Buffer.from(basicAuthInfo);
const headerAuthInfo = buff.toString("base64");
const mainAcctId = authInfo["mainAcctId"];
let bearerToken = "";

let friendsIdList = [];
let twitterFeedDiscordChannelWebhooks = [];


async function runApp() {
	updateBearerToken(headerAuthInfo);

	await retrieveTwitterFeedDiscordWebhooks();

	setInterval(() => {
		console.log("Twitter Feed: Scanning for Tweets...");
		scanForNewTweets((userTimeline) => {
			if(Array.isArray(userTimeline)) {
				let i = userTimeline.length - 1;
				const throttleInterval = setInterval(() => {
					if(i >= 0) {

						const tweet = userTimeline[i];
						const userId = tweet["user"]["id_str"];
						let msg = "__New Tweet From **" + tweet["user"]["name"] + "**__\n";

						let tweetLink = "https://twitter.com/" + tweet["user"]["screen_name"] + "/status/" + tweet["id_str"];

						msg += tweetLink;

						//Hardcoded filter
						//TODO: list of users to follow into db
						if(userId === "25488729") {
							sendTwitterMessage(msg);
						}
						i--;
					} else {
						clearInterval(throttleInterval);
					}
				}, 500);
			}
		});
		updateFriendsIds();
	}, 60000);
}

function updateBearerToken(basicAuthCredentials) {
	const options = {
		headers: {
			'Authorization': "Basic " + basicAuthCredentials
		}
	};
	if(bearerToken === "") {
		httpsPostReq("https://api.twitter.com/oauth2/token?grant_type=client_credentials", "", options, function(tokenJson) {
			try {
				const tokenInfo = JSON.parse(tokenJson);
				bearerToken = tokenInfo["access_token"];
			} catch(e) {
				console.log(e);
			}
		});
	}
}

function updateFriendsIds() {
	if(bearerToken !== "") {

		const options = {
			headers: {
				'Authorization': "Bearer " + bearerToken
			}
		};
		httpsGetReq("https://api.twitter.com/1.1/friends/list.json?user_id=" + mainAcctId, options, function(listJson) {
			try {
				const friendsListObj = JSON.parse(listJson);
				const friendsList = friendsListObj["users"];
				const friendsIds = [];

				for(let i = 0; i < friendsList.length; i++) {
					friendsIds.push(friendsList[i]["id_str"]);
				}

				friendsIdList = friendsIds;
				
			} catch(e) {
				console.log(e);
			}
		});
	}
}

function getUsersTimeline(userId, lastTweetIds, callback) {
	if(bearerToken !== "") {
		let lastUserTweetId = lastTweetIds[userId];
		let queryStyle = "";

		if(!lastUserTweetId) {
			queryStyle = "count=1";
		} else {
			queryStyle = "since_id=" + lastUserTweetId;
		}

		const options = {
			headers: {
				'Authorization': "Bearer " + bearerToken
			}
		};

		httpsGetReq("https://api.twitter.com/1.1/statuses/user_timeline.json?tweet_mode=extended&user_id=" + userId + "&" + queryStyle, options, function(userTimelineJson) {
			try {
				const userTimelineObj = JSON.parse(userTimelineJson);
				callback(userTimelineObj);

			} catch(e) {
				callback(null);
				console.log(e);
			}
		});
	}
}


function scanForNewTweets(callback) {
	twitterLastTweetDb.get().then(documentSnapshot => {
		let lastTweetIds = {};
		if(documentSnapshot.exists) {
			lastTweetIds = documentSnapshot.data();
		}

		
		const payload = {};
		let hasNewTweet = false;
		friendsIdList.forEach(function(userId) {
			getUsersTimeline(userId, lastTweetIds, function(userTimelineObj) {
				callback(userTimelineObj);
				if(Array.isArray(userTimelineObj) && userTimelineObj.length > 0) {
					const latestTweetId = userTimelineObj[0]["id_str"];
					payload[userId] = latestTweetId;
					hasNewTweet = true;
				} else {
					payload[userId] = lastTweetIds[userId];
				}
				if(Object.keys(payload).length === friendsIdList.length && hasNewTweet) {
					twitterLastTweetDb.set(payload).then(res => {
						return null;
					});
				}
			});
		});
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

function httpsGetReq(url, options, callback) {
	options.method = "GET";
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

	req.end();
}

async function retrieveTwitterFeedDiscordWebhooks() {
	const documentSnapshot = await twitterFeedDiscordDestDb.get();
	if(documentSnapshot.exists) {
		const discordWebhooks = documentSnapshot.data()["channelWebhooks"];
		twitterFeedDiscordChannelWebhooks = discordWebhooks ? discordWebhooks : [];
	}
}


function sendTwitterMessage(msg) {
	for(let i = 0; i < twitterFeedDiscordChannelWebhooks.length; i++) {
		sendDiscordWebhookMsg(twitterFeedDiscordChannelWebhooks[i], {"content": msg, "username": "Twitter Feed"});
	}
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

module.exports = {
	runApp: runApp
}