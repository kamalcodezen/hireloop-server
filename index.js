const express = require('express');
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// এনভায়রনমেন্ট ভেরিয়েবল কনফিগারেশন
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI;

// মিডেলওয়্যারসমূহ
app.use(cors());
app.use(express.json()); // ফ্রন্টএন্ড থেকে আসা জেসন ডাটা পার্স করার জন্য

// মঙ্গোডিবি ক্লায়েন্ট সেটআপ ও স্টেবল এপিআই ভার্সন নির্ধারণ
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // ডাটাবেজের সাথে কানেক্ট করা হচ্ছে
        await client.connect();

        // ডাটাবেজ এবং কালেকশনসমূহ ডিক্লেয়ারেশন
        const db = client.db("hire_loop");
        const jobsCollection = db.collection("jobs");
        const companiesCollection = db.collection("companies");
        const userCollection = db.collection("user");
        const applicationCollection = db.collection("application");
        const plansCollection = db.collection("plans");
        const subscriptionCollection = db.collection("subscription");

        console.log("Connected successfully to MongoDB MongoDB collections initialized.");

        // ==========================================================================
        //                                USERS
        // ==========================================================================

        // সব ইউজারের ডিটেইলস নিয়ে আসা (এডমিন প্যানেলের জন্য)
        app.get("/api/user", async (req, res) => {
            try {
                const result = await userCollection.find().toArray();
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error fetching users" });
            }
        });

        // ==========================================================================
        //                                JOBS
        // ==========================================================================

        /* 💡 FIXED: ডুপ্লিকেট রাউট দূর করে অল-ইন-ওয়ান রাউট করা হয়েছে। 
           এটি একই সাথে সব জব নিয়ে আসবে আবার কুয়েরি ফিল্টার (?companyId=...&status=...) ও হ্যান্ডেল করবে। */
        app.get("/api/jobs", async (req, res) => {
            try {
                const query = {};

                // যদি ইউআরএল এ কুয়েরি প্যারামিটার থাকে তবে ফিল্টার এড হবে
                if (req.query.companyId) {
                    query.companyId = req.query.companyId;
                }
                if (req.query.status) {
                    query.status = req.query.status;
                }

                const result = await jobsCollection.find(query).sort({ createdAt: -1 }).toArray(); // নতুন জব সবার আগে দেখাবে
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error fetching jobs" });
            }
        });

        // নির্দিষ্ট আইডি অনুযায়ী সিঙ্গেল জব ডিটেইলস দেখা
        app.get("/api/jobs/:id", async (req, res) => {
            try {
                const { id } = req.params;

                // ওএমজি আইডি ফরমেট চেক (ভুল আইডি দিলে ক্র্যাশ রোধ করবে)
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid Job ID format" });
                }

                const result = await jobsCollection.findOne({ _id: new ObjectId(id) });
                if (!result) return res.status(404).json({ error: "Job opening not found" });

                res.json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error fetching job item" });
            }
        });

        // নতুন জব সার্কুলার পোস্ট করা
        app.post("/api/jobs", async (req, res) => {
            try {
                const jobs = req.body;

                if (!jobs.title || !jobs.companyId) {
                    return res.status(400).json({ error: "Missing required core job information fields" });
                }

                const newJobs = {
                    ...jobs,
                    createdAt: new Date() // সার্ভারের টাইমস্ট্যাম্প সেট করা হচ্ছে
                };
                const result = await jobsCollection.insertOne(newJobs);
                res.status(201).json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error creating job post" });
            }
        });


        // ==========================================================================
        //                              COMPANIES
        // ==========================================================================

        // এডমিন প্যানেলের জন্য সব কোম্পানির লিস্ট ডাটা ফেচ (FIXED: ভুল .skip(6) মুছে দেওয়া হয়েছে)
        app.get("/api/companies", async (req, res) => {
            try {
                const result = await companiesCollection.find().sort({ createdAt: -1 }).toArray();
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error fetching corporate registry" });
            }
        });

        // রিক্রুটার আইডি অনুযায়ী নির্দিষ্ট কোম্পানির সিঙ্গেল প্রোফাইল দেখা nijer company dekha query kore
        app.get("/api/my/companies", async (req, res) => {
            try {
                const query = {};
                if (req.query.recruiterId) {
                    query.recruiterId = req.query.recruiterId;
                } else {
                    return res.status(400).json({ error: "Recruiter ID query param is required" });
                }

                const result = await companiesCollection.findOne(query);
                res.json(result || {});
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error validating recruiter client data" });
            }
        });

        // নতুন কোম্পানি রেজিস্ট্রেশন পোস্ট
        app.post("/api/companies", async (req, res) => {
            try {
                const company = req.body;

                if (!company.name || !company.recruiterId) {
                    return res.status(400).json({ error: "Company profile core inputs are missing" });
                }

                const newCompany = {
                    ...company,
                    status: company.status || "Pending", // ডিফল্ট স্ট্যাটাস পেন্ডিং থাকবে
                    createdAt: new Date()
                };
                const result = await companiesCollection.insertOne(newCompany);
                res.status(201).json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error creating company profile" });
            }
        });

        // এডমিন প্যানেল থেকে কোম্পানির স্ট্যাটাস (Approved / Rejected) পরিবর্তন করা
        app.patch("/api/companies/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const updateData = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid target entity identification metadata ID" });
                }
                if (!updateData?.status) {
                    return res.status(400).json({ error: "Action processing system requires status key updates" });
                }

                const result = await companiesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status: updateData.status
                        }
                    }
                );

                res.json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error applying core state updates" });
            }
        });


        // ==========================================================================
        //                             APPLICATIONS
        // ==========================================================================

        // জব সিকারের নতুন জবে আবেদন বা অ্যাপ্লিকেশন সাবমিট করা
        app.post("/api/application", async (req, res) => {
            try {
                const data = req.body;

                if (!data.jobId || !data.applicantId) {
                    return res.status(400).json({ error: "Missing linkage IDs required for application records" });
                }

                const application = {
                    ...data,
                    createdAt: new Date()
                };
                const result = await applicationCollection.insertOne(application);
                res.status(201).json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error posting candidate application" });
            }
        });

        // জব সিকার বা রিক্রুটার আইডি দিয়ে নির্দিষ্ট অ্যাপ্লিকেশন কুয়েরি করে তুলে আনা
        app.get("/api/application", async (req, res) => {
            try {
                const query = {};
                if (req.query.applicantId) {
                    query.applicantId = req.query.applicantId;
                }
                if (req.query.userId) {
                    query.userId = req.query.userId;
                }

                const cursor = await applicationCollection.find(query).sort({ createdAt: -1 });
                const result = await cursor.toArray();
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error structural directory sync failed" });
            }
        });


        // ==========================================================================
        //                                PLANS
        // ==========================================================================

        // আইডি ফিল্টার দিয়ে নির্দিষ্ট পেমেন্ট বা সাবস্ক্রিপশন প্ল্যান খুঁজে বের করা
        app.get("/api/plans", async (req, res) => {
            try {
                const query = {};
                if (req.query.plan_id) {
                    query.id = req.query.plan_id; // প্ল্যানের সিস্টেম কাস্টম স্ট্রিং আইডি ম্যাচিং
                }
                const result = await plansCollection.findOne(query);
                res.json(result || {});
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error fetching subscription directory metrics" });
            }
        });


        // ==========================================================================
        //                            SUBSCRIPTIONS
        // ==========================================================================

        // ইউজারের প্রিমিয়াম প্ল্যান কেনা এবং ইউজারের কালেকশনে প্ল্যান আপডেট করা (Transaction Flow)
        app.post("/api/subscription", async (req, res) => {
            try {
                const data = req.body;

                if (!data.email || !data.planId) {
                    return res.status(400).json({ error: "Email identity token and core plan tracking codes missing" });
                }

                const subsInfo = {
                    ...data,
                    createdAt: new Date()
                };

                // ১. সাবস্ক্রিপশন ট্র্যাকিং লগে ডাটা ইনসার্ট করা হচ্ছে
                await subscriptionCollection.insertOne(subsInfo);

                // ২. মেইন ইউজার অবজেক্টের কারেন্ট মেম্বারশিপ প্ল্যান টাইপ আপডেট করা হচ্ছে
                const filter = { email: data.email };
                const updateDocument = {
                    $set: {
                        plan: data.planId
                    }
                };

                const updateResult = await userCollection.updateOne(filter, updateDocument);
                res.json(updateResult);
            } catch (error) {
                res.status(500).json({ error: "Internal Server Error deploying membership ledger tokens" });
            }
        });


        // ডাটাবেজ কানেক্টিভিটি ভেরিফিকেশন কমান্ড টেস্ট পিন
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // কালেকশন লুপ সচল রাখার জন্য এটি ক্লোজ করা যাবে না
        // await client.close();
    }
}
run().catch(console.dir);

// রুট বেস হেলথ চেক পাথ রাউট
app.get('/', (req, res) => {
    res.send('HireLoop cluster system environment is running active!')
});

// সার্ভার লিসেনিং পোর্ট রানার
app.listen(port, () => {
    console.log(`HireLoop app listening on port ${port}`)
});