// db.js (এক্সপ্রেস ব্যাকএন্ডের গ্লোবাল কানেকশন ক্যাশ)
const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGODB_URI;

if (!uri) {
    throw new Error("Please add your MONGODB_URI to .env file");
}

let client;
let clientPromise;

// 💡 আসল ম্যাজিক: নোড প্রসেসের গ্লোবাল মেমোরি চেক করা হচ্ছে যেন nodemon রিস্টার্ট নিলেও নতুন কানেকশন না হয়
if (!global._mongoClientPromise) {
    client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });
    global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

// ডাটাবেজ অবজেক্ট সরাসরি কুয়েরি করার জন্য হেল্পার ফাংশন
async function getDb() {
    const connectedClient = await clientPromise;
    return connectedClient.db("hire_loop"); // তোমার ডাটাবেজের নাম
}

module.exports = { getDb };