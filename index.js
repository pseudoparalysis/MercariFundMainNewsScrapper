//The same firebase admin will be used for all other required modules
const admin = require("firebase-admin");
const serviceAccount = require("./config/your-firebase-auth-file.json");
admin.initializeApp({
	credential: admin.credential.cert(serviceAccount)
});


const oandaNewsScrapper = require("./lib/oandaNewsScrapper");
const twitterFeedScrapper = require("./lib/twitterFeed");
const theFlyScrapper = require("./lib/theFlyScrapper");

oandaNewsScrapper.runApp();
twitterFeedScrapper.runApp();
theFlyScrapper.runApp();