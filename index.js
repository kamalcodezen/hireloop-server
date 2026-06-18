const express = require('express');
const cors = require('cors');
const dotenv = require("dotenv");

// 💡 ১. সবার আগে dotenv রান করবে যেন নোড জেএস .env ফাইলটি আগে লোড করতে পারে
dotenv.config();

// 💡 ২. ডট-এনভ লোড হওয়ার পরেই কেবল আমাদের db.js এর গ্লোবাল কানেকশন হেল্পার ইম্পোর্ট হবে
const { getDb } = require('./db');
const { ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// মিডেলওয়্যারসমূহ
app.use(cors());
app.use(express.json()); // ফ্রন্টএন্ড থেকে আসা জেসন ডাটা পার্স করার জন্য


// ==========================================================================
// 🧙‍♂️ জাদুর মিডলওয়্যার: এটি প্রতিটা রিকোয়েস্টে অটোমেটিক কালেকশনগুলো রেডি করে দেবে
// ==========================================================================
app.use(async (req, res, next) => {
    try {
        const db = await getDb(); // গ্লোবাল ক্যাশ কানেকশন পুল থেকে ডাটাবেজ কল

        // সব কালেকশনকে 'req.db' অবজেক্টের ভেতর ঢুকিয়ে দেওয়া হলো
        req.db = {
            users: db.collection("user"),
            jobs: db.collection("jobs"),
            companies: db.collection("companies"),
            applications: db.collection("application"),
            plans: db.collection("plans"),
            subscriptions: db.collection("subscription"),
            sessionCollection: db.collection("session")
        };

        next(); // পরের ধাপে (এপিআই রাউটে) যাওয়ার অনুমতি দেওয়া হলো
    } catch (error) {
        res.status(500).json({ error: "Database connection failed via middleware" });
    }
});

// ==========================================================================
// 🔐 AUTHENTICATION & SECURITY MIDDLEWARES (🛡️ সম্পূর্ণ ফিক্সড ও সুরক্ষিত)
// ==========================================================================

// 🛡️ টোকেন ভেরিফাই করার মিডলওয়্যার (ইউজার লগইন আছে কি না চেক করে)
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers?.authorization; // রিকোয়েস্ট হেডার থেকে টোকেন নেওয়া হলো
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: "Unauthorized: Missing token" });
        }

        const token = authHeader.split(" ")[1]; // 'Bearer TOKEN_STRING' থেকে শুধু মেইন টোকেনটা আলাদা করা হলো

        const query = { token: token };
        const session = await req.db.sessionCollection.findOne(query); // সেশন কালেকশনে টোকেনটি খোঁজা হচ্ছে

        if (!session) {
            return res.status(401).json({ message: "Unauthorized: Invalid Session" });
        }

        const userId = session.userId;
        const user = await req.db.users.findOne({ _id: new ObjectId(userId) }); // সেশনের ইউজার আইডি দিয়ে ইউজারকে খোঁজা হচ্ছে

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        req.user = user; // খুঁজে পাওয়া ইউজারকে রিকোয়েস্টের ভেতর পাস করে দেওয়া হলো যেন পরের রাউটগুলো ব্যবহার করতে পারে
        next();
    } catch (error) {
        return res.status(500).json({ error: "Authentication internal error" });
    }
};

// 🧑‍💻 শুধুমাত্র জব সিকার (Job Seeker) ভেরিফাই করার মিডলওয়্যার
const verifySeeker = (req, res, next) => {
    if (req.user?.role !== "seeker") {
        return res.status(403).json({ message: "Forbidden: Seeker access required" });
    }
    next();
};

// 💼 শুধুমাত্র রিক্রুটার (Recruiter) ভেরিফাই করার মিডলওয়্যার
const verifyRecruiter = (req, res, next) => {
    if (req.user?.role !== "recruiter") {
        return res.status(403).json({ message: "Forbidden: Recruiter access required" });
    }
    next();
};

// 👑 শুধুমাত্র মেইন এডমিন (Admin) ভেরিফাই করার মিডলওয়্যার
const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
    }
    next();
};


// ==========================================================================
//                                🎯 USERS
// ==========================================================================

// সব ইউজারের ডিটেইলস নিয়ে আসা (এডমিন প্যানেলের জন্য)
app.get("/api/user", async (req, res) => {
    try {
        // 👈 মিডলওয়্যারের কারণে সরাসরি req.db.users ব্যবহার করা যাচ্ছে
        const result = await req.db.users.find().toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching users" });
    }
});

// ==========================================================================
//                                🎯 JOBS
// ==========================================================================

// অল-ইন-ওয়ান রাউট (সব জব নিয়ে আসা + কোয়েরি ফিল্টারিং)
app.get("/api/jobs", async (req, res) => {
    try {
        const query = {};

        // ইউআরএল কোয়েরি প্যারামিটার (?companyId=...&status=...) হ্যান্ডেল করা
        if (req.query.companyId) {
            query.companyId = req.query.companyId;

            if (req.user?._id.toString() !== req.query.applicantId) {
                return res.status(403).json({ message: "Forbidden access identity mismatch" });
            }
        }

        if (req.query.status) {
            query.status = req.query.status;
        }

        // 👈 কোনো এক্সট্রা লাইন ছাড়া সরাসরি req.db.jobs থেকে ডাটা সর্ট করে আনা
        const result = await req.db.jobs.find(query).sort({ createdAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching jobs" });
    }
});

// নির্দিষ্ট আইডি অনুযায়ী সিঙ্গেল জব ডিটেইলস দেখা
app.get("/api/jobs/:id", async (req, res) => {
    try {
        const { id } = req.params;

        // মঙ্গোডিবি আইডি ফরমেট ভ্যালিডেশন চেক (ভুল আইডি ফরম্যাটে ক্র্যাশ ঠেকাতে)
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid Job ID format" });
        }

        const result = await req.db.jobs.findOne({ _id: new ObjectId(id) });
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
            createdAt: new Date() // কারেন্ট সার্ভার টাইমস্ট্যাম্প অ্যাড করা হলো
        };
        const result = await req.db.jobs.insertOne(newJobs);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error creating job post" });
    }
});

// ==========================================================================
//                               🎯 COMPANIES
// ==========================================================================

// 🚀 মঙ্গোডিবির এগ্রিগেশন পাইপলাইন শুরু হচ্ছে (লুপ ছাড়া ১ বারে নিখুঁত ডাটা আনার জাদুর ফ্যাক্টরি)
app.get("/api/companies", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const companiesWithJobCount = await req.db.companies.aggregate([
            {
                // 🔗 ধাপ ১: $lookup দিয়ে companies কালেকশনের সাথে jobs কালেকশনের জোড়াতালি বা রিলেশন তৈরি করা
                $lookup: {
                    from: "jobs", // কোন কালেকশন থেকে ডাটা আসবে? উত্তর: jobs কালেকশন
                    let: {
                        company_obj_id: "$_id", // কোম্পানির আসল ObjectId চলক
                        company_str_id: { $toString: "$_id" } // কোম্পানির আইডি-কে স্ট্রিং বানানো চলক
                    },
                    pipeline: [
                        {
                            // 🎯 ম্যাচিং লজিক আপডেট: জবের companyId স্ট্রিং হোক বা ObjectId—উভয়ের সাথেই মিলিয়ে দেখা হচ্ছে
                            $match: {
                                $expr: {
                                    $or: [
                                        { $eq: ["$companyId", "$$company_str_id"] },
                                        { $eq: ["$companyId", "$$company_obj_id"] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "allJobs" // ম্যাচ হওয়া সব জব এই 'allJobs' নামের অ্যারে (Array) তে জমা হবে
                }
            },
            {
                // ➕ ্মধাপ ২: $addFields দিয়ে কোম্পানির সব পুরোনো ডাটা ঠিক রেখে নতুন একটা চাবি (Field) যোগ করা
                $addFields: {
                    applications: { $size: "$allJobs" } // 'allJobs' থলের ভেতর কয়টা জব আছে সেই সংখ্যাটা গুনে applications-এ রাখা হলো
                }
            },
            {
                // ✂️ ধাপ ৩: $project দিয়ে জবের ফুল লিস্টের বড় অ্যারেটা ডিলিট (0) করে দেওয়া যেন এপিআই হালকা ও ফাস্ট থাকে
                $project: {
                    allJobs: 0 // জবের ডিটেইলস আমাদের লাগবে না (শুধু সংখ্যা হলেই হবে), তাই এটিকে ০ করে বাদ দেওয়া হলো
                }
            },
            {
                // 📊 ধাপ ৪: $sort দিয়ে সিরিয়াল ঠিক করা
                $sort: { createdAt: -1 } // একদম নতুন তৈরি হওয়া কোম্পানিটি এডমিন স্ক্রিনে সবার ওপরে দেখাবে
            }
        ]).toArray(); // সব ধাপ পার হওয়া ডাটাকে একটা সুন্দর অ্যারে বানিয়ে ফেলা হলো

        // 🎯 সব ডেটা সফলভাবে ফ্রন্টএন্ডে রেসপন্স হিসেবে পাঠিয়ে দেওয়া হলো
        res.json(companiesWithJobCount);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching corporate registry" });
    }
});

// রিক্রুটার আইডি অনুযায়ী নির্দিষ্ট কোম্পানির সিঙ্গেল প্রোফাইল দেখা
app.get("/api/my/companies", async (req, res) => {
    try {
        const query = {};

        if (req.query.recruiterId) {
            query.recruiterId = req.query.recruiterId;
        } else {
            return res.status(400).json({ error: "Recruiter ID query param is required" });
        }

        const result = await req.db.companies.findOne(query);
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
        const result = await req.db.companies.insertOne(newCompany);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error creating company profile" });
    }
});

// এডমিন প্যানেল থেকে কোম্পানির স্ট্যাটাস (Approved / Rejected) পরিবর্তন করা
app.patch("/api/companies/:id", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid target entity identification metadata ID" });
        }
        if (!updateData?.status) {
            return res.status(400).json({ error: "Action processing system requires status key updates" });
        }

        const result = await req.db.companies.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: updateData.status } }
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error applying core state updates" });
    }
});

// ==========================================================================
//                             🎯 APPLICATIONS
// ==========================================================================

// নতুন অ্যাপ্লিকেশন সাবমিট করা
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
        const result = await req.db.applications.insertOne(application);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error posting candidate application" });
    }
});

// অ্যাপ্লিকেশন কুয়েরি করে তুলে আনা
app.get("/api/application", async (req, res) => {
    try {
        const query = {};

        if (req.query.applicantId) {
            query.applicantId = req.query.applicantId;
        }
        if (req.query.userId) {
            query.userId = req.query.userId;
        }

        const result = await req.db.applications.find(query).sort({ createdAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error structural directory sync failed" });
    }
});

// ==========================================================================
//                                 🎯 PLANS
// ==========================================================================

// আইডি ফিল্টার দিয়ে নির্দিষ্ট সাবস্ক্রিপশন প্ল্যান খুঁজে বের করা
app.get("/api/plans", async (req, res) => {
    try {
        const query = {};

        if (req.query.plan_id) {
            query.id = req.query.plan_id;
        }
        const result = await req.db.plans.findOne(query);
        res.json(result || {});
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching subscription directory metrics" });
    }
});

// ==========================================================================
//                              🎯 SUBSCRIPTIONS
// ==========================================================================

// প্রিমিয়াম প্ল্যান কেনা এবং ইউজারের কালেকশনে প্ল্যান আপডেট করা
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
        await req.db.subscriptions.insertOne(subsInfo);

        // ২. মেইন ইউজার অবজেক্টের মেম্বারশিপ প্ল্যান আপডেট করা হচ্ছে
        const filter = { email: data.email };
        const updateDocument = {
            $set: { plan: data.planId }
        };

        const updateResult = await req.db.users.updateOne(filter, updateDocument);
        res.json(updateResult);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error deploying membership ledger tokens" });
    }
});

// ==========================================================================
//                          ⚙️ SYSTEM RUNNERS
// ==========================================================================

// রুট বেস হেলথ চেক পাথ রাউট
app.get('/', (req, res) => {
    res.send('HireLoop cluster system environment is running active, optimized and clean!');
});

// সার্ভার লিসেনিং পোর্ট রানার
app.listen(port, () => {
    console.log(`HireLoop app listening on port ${port}`);
});






























/*

const express = require('express');
const dotenv = require("dotenv");
const cors = require("cors");

// এনভায়রনমেন্ট ভেরিয়েবল কনফিগারেশন
dotenv.config();


// 💡 ১. আমাদের নতুন গ্লোবাল কানেকশন হেল্পারটি ইম্পোর্ট করা হলো
const { getDb } = require('./db');
const { ObjectId } = require('mongodb');



const app = express();
const port = process.env.PORT || 5000;

// মিডেলওয়্যারসমূহ
app.use(cors());
app.use(express.json()); // ফ্রন্টএন্ড থেকে আসা জেসন ডাটা পার্স করার জন্য

// ==========================================================================
//                                USERS
// ==========================================================================

// সব ইউজারের ডিটেইলস নিয়ে আসা (এডমিন প্যানেলের জন্য)
app.get("/api/user", async (req, res) => {
    try {
        const db = await getDb(); // গ্লোবাল কানেকশন পুল থেকে ডাটাবেজ কল
        const userCollection = db.collection("user");

        const result = await userCollection.find().toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching users" });
    }
});

// ==========================================================================
//                                JOBS
// ==========================================================================

// অল-ইন-ওয়ান রাউট (সব জব নিয়ে আসা + ফিল্টারিং)
app.get("/api/jobs", async (req, res) => {
    try {
        const db = await getDb();
        const jobsCollection = db.collection("jobs");
        const query = {};

        if (req.query.companyId) {
            query.companyId = req.query.companyId;
        }
        if (req.query.status) {
            query.status = req.query.status;
        }

        const result = await jobsCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching jobs" });
    }
});

// নির্দিষ্ট আইডি অনুযায়ী সিঙ্গেল জব ডিটেইলস দেখা
app.get("/api/jobs/:id", async (req, res) => {
    try {
        const db = await getDb();
        const jobsCollection = db.collection("jobs");
        const { id } = req.params;

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
        const db = await getDb();
        const jobsCollection = db.collection("jobs");
        const jobs = req.body;

        if (!jobs.title || !jobs.companyId) {
            return res.status(400).json({ error: "Missing required core job information fields" });
        }

        const newJobs = {
            ...jobs,
            createdAt: new Date()
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

// এডমিন প্যানেলের জন্য সব কোম্পানির লিস্ট ডাটা ফেচ
app.get("/api/companies", async (req, res) => {
    try {
        const db = await getDb();
        const companiesCollection = db.collection("companies");

        const result = await companiesCollection.find().sort({ createdAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching corporate registry" });
    }
});

// রিক্রুটার আইডি অনুযায়ী নির্দিষ্ট কোম্পানির সিঙ্গেল প্রোফাইল দেখা
app.get("/api/my/companies", async (req, res) => {
    try {
        const db = await getDb();
        const companiesCollection = db.collection("companies");
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
        const db = await getDb();
        const companiesCollection = db.collection("companies");
        const company = req.body;

        if (!company.name || !company.recruiterId) {
            return res.status(400).json({ error: "Company profile core inputs are missing" });
        }

        const newCompany = {
            ...company,
            status: company.status || "Pending",
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
        const db = await getDb();
        const companiesCollection = db.collection("companies");
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
            { $set: { status: updateData.status } }
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error applying core state updates" });
    }
});

// ==========================================================================
//                             APPLICATIONS
// ==========================================================================

// নতুন অ্যাপ্লিকেশন সাবমিট করা
app.post("/api/application", async (req, res) => {
    try {
        const db = await getDb();
        const applicationCollection = db.collection("application");
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

// অ্যাপ্লিকেশন কুয়েরি করে তুলে আনা
app.get("/api/application", async (req, res) => {
    try {
        const db = await getDb();
        const applicationCollection = db.collection("application");
        const query = {};

        if (req.query.applicantId) {
            query.applicantId = req.query.applicantId;
        }
        if (req.query.userId) {
            query.userId = req.query.userId;
        }

        const result = await applicationCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error structural directory sync failed" });
    }
});

// ==========================================================================
//                                PLANS
// ==========================================================================

app.get("/api/plans", async (req, res) => {
    try {
        const db = await getDb();
        const plansCollection = db.collection("plans");
        const query = {};

        if (req.query.plan_id) {
            query.id = req.query.plan_id;
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

app.post("/api/subscription", async (req, res) => {
    try {
        const db = await getDb();
        const subscriptionCollection = db.collection("subscription");
        const userCollection = db.collection("user");
        const data = req.body;

        if (!data.email || !data.planId) {
            return res.status(400).json({ error: "Email identity token and core plan tracking codes missing" });
        }

        const subsInfo = {
            ...data,
            createdAt: new Date()
        };

        await subscriptionCollection.insertOne(subsInfo);

        const filter = { email: data.email };
        const updateDocument = {
            $set: { plan: data.planId }
        };

        const updateResult = await userCollection.updateOne(filter, updateDocument);
        res.json(updateResult);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error deploying membership ledger tokens" });
    }
});

// রুট বেস হেলথ চেক পাথ রাউট
app.get('/', (req, res) => {
    res.send('HireLoop cluster system environment is running active and optimized!');
});

// সার্ভার লিসেনিং পোর্ট রানার
app.listen(port, () => {
    console.log(`HireLoop app listening on port ${port}`);
});



*/




































/*    
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
           এটি একই সাথে সব জব নিয়ে আসবে আবার কুয়েরি ফিল্টার (?companyId=...&status=...) ও হ্যান্ডেল করবে। 
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

*/