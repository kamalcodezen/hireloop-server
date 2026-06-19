const express = require('express'); // এক্সপ্রেস ফ্রেমওয়ার্ক ইম্পোর্ট করা হলো (সার্ভার তৈরি করার জন্য)
const cors = require('cors'); // কর্স মিডেলওয়্যার ইম্পোর্ট করা হলো (ফ্রন্টএন্ডকে এপিআই কল করার অনুমতি দেওয়ার জন্য)
const dotenv = require("dotenv"); // ডট-এনভ ইম্পোর্ট করা হলো (.env ফাইল থেকে সিক্রেট ডাটা পড়ার জন্য)

// 💡 ১. সবার আগে dotenv রান করবে যেন নোড জেএস .env ফাইলটি আগে লোড করতে পারে
dotenv.config();

// 💡 ২. ডট-এনভ লোড হওয়ার পরেই কেবল আমাদের db.js এর গ্লোবাল কানেকশন হেল্পার ইম্পোর্ট হবে
const { getDb } = require('./db'); // ডাটাবেজ কানেকশন হেল্পার ফাংশন আনা হলো
const { ObjectId } = require('mongodb'); // মঙ্গোডিবির ইউনিক আইডি হ্যান্ডেল করার জন্য ওআইডি ক্লাস আনা হলো

const app = express(); // এক্সপ্রেসের একটি ইনস্ট্যান্স বা অ্যাপ তৈরি করা হলো
const port = process.env.PORT || 5000; // লোকাল হোস্টে চালানোর জন্য পোর্ট নির্ধারণ (ডিফল্ট ৫০০০)

// মিডেলওয়্যারসমূহ
app.use(cors()); // সব ধরনের ফ্রন্টএন্ড ডোমেইন থেকে রিকোয়েস্ট এক্সেপ্ট করার জন্য কর্স চালু করা হলো
app.use(express.json()); // ফ্রন্টএন্ড থেকে পাঠানো JSON ডাটা যেন সার্ভার পড়তে পারে, সেজন্য এটি দরকার


// ==========================================================================
// 🧙‍♂️ জাদুর মিডলওয়্যার: এটি প্রতিটা রিকোয়েস্টে অটোমেটিক কালেকশনগুলো রেডি করে দেবে
// ==========================================================================
app.use(async (req, res, next) => {
    try {
        const db = await getDb(); // গ্লোবাল কানেকশন পুল থেকে মঙ্গোডিবি ডাটাবেজ অবজেক্ট কল করা হলো

        // ডাটাবেজের সব কালেকশন বা টেবিলকে 'req.db' অবজেক্টের ভেতর ঢুকিয়ে দেওয়া হলো যেন সব রাউটে সহজে ব্যবহার করা যায়
        req.db = {
            users: db.collection("user"), // ইউজারদের ডাটা রাখার টেবিল
            jobs: db.collection("jobs"), // চাকরির সার্কুলার রাখার টেবিল
            companies: db.collection("companies"), // কোম্পানির প্রোফাইল রাখার টেবিল
            applications: db.collection("application"), // চাকরির আবেদনের ডাটা রাখার টেবিল
            plans: db.collection("plans"), // সাবস্ক্রিপশন প্ল্যান (Pricing) রাখার টেবিল
            subscriptions: db.collection("subscription"), // কে কোন প্ল্যান কিনল তার ট্র্যাকিং টেবিল
            sessionCollection: db.collection("session") // লগইন করা ইউজারদের সেশন বা টোকেন রাখার টেবিল
        };

        next(); // কালেকশন রেডি হয়ে গেলে পরের ধাপে (বা মেইন এপিআই রাউটে) যাওয়ার অনুমতি দেওয়া হলো
    } catch (error) {
        res.status(500).json({ error: "Database connection failed via middleware" }); // ডাটাবেজ কানেক্ট না হলে এরর মেসেজ যাবে
    }
});

// ==========================================================================
// 🔐 AUTHENTICATION & SECURITY MIDDLEWARES (🛡️ সম্পূর্ণ ফিক্সড ও সুরক্ষিত)
// ==========================================================================

// 🛡️ টোকেন ভেরিফাই করার মিডলওয়্যার (ইউজার লগইন আছে কি না চেক করে)
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers?.authorization; // রিকোয়েস্ট হেডার থেকে 'Authorization' ডাটা নেওয়া হলো
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: "Unauthorized: Missing token" }); // টোকেন না থাকলে আটকে দেবে
        }

        const token = authHeader.split(" ")[1]; // 'Bearer TOKEN_STRING' থেকে শুধু মেইন টোকেন স্ট্রিংটি আলাদা করা হলো

        const query = { token: token };
        const session = await req.db.sessionCollection.findOne(query); // সেশন কালেকশনে টোকেনটি সত্যি আছে কি না খোঁজা হচ্ছে

        if (!session) {
            return res.status(401).json({ message: "Unauthorized: Invalid Session" }); // সেশন এক্সপায়ার বা ইনভ্যালিড হলে রিজেক্ট করবে
        }

        const userId = session.userId;
        const user = await req.db.users.findOne({ _id: new ObjectId(userId) }); // সেশনের ইউজার আইডি দিয়ে আসল ইউজারকে ডাটাবেজে খোঁজা হচ্ছে

        if (!user) {
            return res.status(404).json({ message: "User not found" }); // ইউজার ডিলিট হয়ে গিয়ে থাকলে এরর দেবে
        }

        req.user = user; // খুঁজে পাওয়া ইউজার অবজেক্টকে 'req.user' এ সেভ করা হলো যেন পরের রাউটগুলো দেখতে পারে সে কে
        next(); // সব ঠিক থাকলে পরের এপিআই রাউটে যাওয়ার পারমিশন দেওয়া হলো
    } catch (error) {
        return res.status(500).json({ error: "Authentication internal error" });
    }
};

// 🧑‍💻 শুধুমাত্র জব সিকার (Job Seeker) ভেরিফাই করার মিডলওয়্যার
const verifySeeker = (req, res, next) => {
    if (req.user?.role !== "seeker") {
        return res.status(403).json({ message: "Forbidden: Seeker access required" }); // ইউজার যদি চাকরিপ্রার্থী না হয় তবে আটকে দেবে
    }
    next();
};

// 💼 শুধুমাত্র রিক্রুটার (Recruiter) ভেরিফাই করার মিডলওয়্যার
const verifyRecruiter = (req, res, next) => {
    if (req.user?.role !== "recruiter") {
        return res.status(403).json({ message: "Forbidden: Recruiter access required" }); // ইউজার যদি চাকরিদাতা বা কোম্পানি না হয় তবে আটকে দেবে
    }
    next();
};

// 👑 শুধুমাত্র মেইন এডমিন (Admin) ভেরিফাই করার মিডলওয়্যার
const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admin access required" }); // ইউজার যদি সাইটের এডমিন না হয় তবে আটকে দেবে
    }
    next();
};


// ==========================================================================
//                                 🎯 USERS
// ==========================================================================

// সব ইউজারের ডিটেইলস নিয়ে আসা (এডমিন প্যানেলে ইউজার লিস্ট দেখার জন্য)
app.get("/api/user", async (req, res) => {
    try {
        const result = await req.db.users.find().toArray(); // ইউজার টেবিল থেকে সব ডাটা খুঁজে অ্যারে বানানো হলো
        res.json(result); // ফ্রন্টএন্ডে জেসন আকারে পাঠিয়ে দেওয়া হলো
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching users" });
    }
});

// ==========================================================================
//                                 🎯 JOBS
// ==========================================================================

// অল-ইন-ওয়ান রাউট (সব জব নিয়ে আসা + সার্চ + ক্যাটাগরি ফিল্টার + ডাইনামিক পেজিনেশন)
app.get("/api/jobs", async (req, res) => {
    try {
        const query = {}; // শুরুতে খালি কুয়েরি অবজেক্ট নেওয়া হলো

        // ১. সার্চ কুয়েরি ফিল্টার (ইউজার টাইটেল, কোম্পানি বা রিকোয়ারমেন্টস লিখে সার্চ করলে)
        if (req.query.search) {
            query.$or = [
                { title: { $regex: req.query.search, $options: "i" } }, // 'i' মানে ছোট হাতের বা বড় হাতের অক্ষর কোনো সমস্যা নয়
                { companyName: { $regex: req.query.search, $options: "i" } },
                { companyLocation: { $regex: req.query.search, $options: "i" } },
                { requirements: { $regex: req.query.search, $options: "i" } }
            ];
        }

        // ২. ড্রপডাউন ফিল্টারসমূহ (টাইপ, ক্যাটাগরি বা রিমোট সিলেক্ট করলে)
        if (req.query.type) query.type = req.query.type;
        if (req.query.category) query.category = req.query.category;
        if (req.query.isRemote) query.isRemote = req.query.isRemote === "true";
        if (req.query.status) query.status = req.query.status;

        // 🔗 নির্দিষ্ট কোম্পানির চাকরি ফিল্টার করা
        if (req.query.companyId) {
            query.companyId = req.query.companyId;
            if (req.user?._id.toString() !== req.query.applicantId) {
                return res.status(403).json({ message: "Forbidden access identity mismatch" }); // সিকিউরিটি ম্যাচিং
            }
        }

        // 📊 ৩. ডাইনামিক পেজিনেশন ক্যালকুলেশন (১২টি করে ডাটা ভাগ করা)
        const page = parseInt(req.query.page) || 1; // বর্তমান পেজ নাম্বার (কিছু না থাকলে পেজ ১)
        const perPage = parseInt(req.query.perPage) || 12; // প্রতি পেজে কয়টি চাকরি দেখাবে (ডিফল্ট ১২টি)
        const skipItems = (page - 1) * perPage; // প্রথম কতগুলো চাকরি বাদ দিয়ে ডাটা আনা শুরু করবে তার হিসাব

        // ৪. এই ফিল্টারে ডাটাবেজে মোট কতটি চাকরি আছে তা গোনা (পেজিনেশন বাটনের জন্য জরুরি)
        const total = await req.db.jobs.countDocuments(query);

        // ৫. শুধুমাত্র ওই পেজের ১২টি চাকরি একদম নতুনগুলোর সিরিয়াল অনুযায়ী খুঁজে আনা
        const jobs = await req.db.jobs.find(query).sort({ createdAt: -1 }).skip(skipItems).limit(perPage).toArray();

        // 🚀 ফ্রন্টএন্ডে চাকরি এবং টোটাল সংখ্যা দুইটাই একসাথে অবজেক্ট আকারে পাঠানো হলো
        res.json({ jobs, total });
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching jobs" });
    }
});

// নির্দিষ্ট আইডি অনুযায়ী সিঙ্গেল জব ডিটেইলস দেখা (চাকরির ওপর ক্লিক করলে যে পেজ ওপেন হয়)
app.get("/api/jobs/:id", async (req, res) => {
    try {
        const { id } = req.params; // ইউআরএল থেকে আইডির মান নেওয়া হলো

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid Job ID format" }); // আইডি ফরম্যাট ভুল হলে ক্র্যাশ ঠেকাতে রিটার্ন করবে
        }

        const result = await req.db.jobs.findOne({ _id: new ObjectId(id) }); // আইডি ম্যাচ করে চাকরিটি খোঁজা হচ্ছে
        if (!result) return res.status(404).json({ error: "Job opening not found" });

        res.json(result); // চাকরিটি পাওয়া গেলে ফ্রন্টএন্ডে পাঠানো হলো
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching job item" });
    }
});

// নতুন জব সার্কুলার পোস্ট করা (কোম্পানি বা রিক্রুটাররা নতুন চাকরি ছাড়লে)
app.post("/api/jobs", async (req, res) => {
    try {
        const jobs = req.body; // ফ্রন্টএন্ডের ফরম থেকে পাঠানো ডাটা নেওয়া হলো

        if (!jobs.title || !jobs.companyId) {
            return res.status(400).json({ error: "Missing required core job information fields" }); // টাইটেল না থাকলে রিজেক্ট করবে
        }

        const newJobs = {
            ...jobs,
            createdAt: new Date() // চাকরিটি কখন পোস্ট হলো তার লাইভ সার্ভার টাইমস্ট্যাম্প অ্যাড করা হলো
        };
        const result = await req.db.jobs.insertOne(newJobs); // মঙ্গোডিবিতে ইনসার্ট করা হলো
        res.status(201).json(result); // সফলভাবে তৈরি হওয়ার রেসপন্স
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error creating job post" });
    }
});

// ==========================================================================
//                                 🎯 COMPANIES
// ==========================================================================

// 🚀 মঙ্গোডিবির এগ্রিগেশন পাইপলাইন (লুপ ছাড়া ১ বারে কোম্পানির ডাটা ও তার আন্ডারে মোট জবের সংখ্যা আনা)
app.get("/api/companies", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const companiesWithJobCount = await req.db.companies.aggregate([
            {
                // 🔗   ধাপ ১: $lookup দিয়ে companies কালেকশনের সাথে jobs কালেকশনের রিলেশন/জোড়াতালি দেওয়া
                $lookup: {
                    from: "jobs", // jobs কালেকশন থেকে ডাটা জুড়বে
                    let: {
                        company_obj_id: "$_id", // কোম্পানির মেইন আইডি অবজেক্ট ফরম্যাটে
                        company_str_id: { $toString: "$_id" } // কোম্পানির আইডি স্ট্রিং ফরম্যাটে
                    },
                    pipeline: [
                        {
                            // জবের companyId স্ট্রিং হোক বা ObjectId—উভয়ের সাথে কোম্পানির মিল খুঁজে ম্যাচ করা হচ্ছে
                            $match: {
                                $expr: {
                                    $or: [
                                        { $eq: ["$companyId", "$$company_str_id"] }, // 🎯 ফিক্সড: টাইপো এরর ট্রিপল ডলার থেকে ডাবল ডলার করা হলো
                                        { $eq: ["$companyId", "$$company_obj_id"] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "allJobs" // ম্যাচ হওয়া সব জব এই 'allJobs' নামের অ্যারেতে টেম্পোরারি জমা হবে
                }
            },
            {
                // ➕   ধাপ ২: $addFields দিয়ে কোম্পানির সব পুরোনো ডাটা ঠিক রেখে নতুন একটা চাবি 'applications' যোগ করা
                $addFields: {
                    applications: { $size: "$allJobs" } // 'allJobs' থলের ভেতর কয়টি চাকরি পাওয়া গেল সেই সংখ্যাটা গুনে এখানে রাখা হলো
                }
            },
            {
                // ✂️     ধাপ ৩: $project দিয়ে জবের ফুল ডিটেইলস অ্যারেটা রিমুভ (0) করা যেন এপিআই রেসপন্স হালকা ও ফাস্ট থাকে
                $project: {
                    allJobs: 0 // জবের ডিটেইলস আমাদের লাগবে না (শুধু সংখ্যা হলেই হবে)
                }
            },
            {
                // 📊    ধাপ ৪: $sort দিয়ে সর্টিং করা (একদম নতুন তৈরি হওয়া কোম্পানি এডমিন স্ক্রিনে সবার ওপরে দেখাবে)
                $sort: { createdAt: -1 }
            }
        ]).toArray();

        res.json(companiesWithJobCount); // প্রসেস হওয়া কোম্পানির মেগা ডাটা ফ্রন্টএন্ডে পাঠানো হলো
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching corporate registry" });
    }
});

// রিক্রুটার আইডি অনুযায়ী নির্দিষ্ট কোম্পানির সিঙ্গেল প্রোফাইল দেখা (ড্যাশবোর্ডে নিজের কোম্পানি চেক করা)
app.get("/api/my/companies", async (req, res) => {
    try {
        const query = {};

        if (req.query.recruiterId) {
            query.recruiterId = req.query.recruiterId; // কুয়েরি থেকে রিক্রুটার আইডি লক করা হলো
        } else {
            return res.status(400).json({ error: "Recruiter ID query param is required" });
        }

        const result = await req.db.companies.findOne(query); // ওই রিক্রুটারের কোম্পানিটি খুঁজে আনা হচ্ছে
        res.json(result || {}); // না পাওয়া গেলে খালি অবজেক্ট রিটার্ন করবে
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error validating recruiter client data" });
    }
});

// নতুন কোম্পানি প্রোফাইল তৈরি করা (প্রথমবার কোম্পানি প্রোফাইল রেজিস্ট্রেশন ফরম সাবমিট করলে)
app.post("/api/companies", async (req, res) => {
    try {
        const company = req.body;

        if (!company.name || !company.recruiterId) {
            return res.status(400).json({ error: "Company profile core inputs are missing" });
        }

        const newCompany = {
            ...company,
            status: company.status || "Pending", // নতুন কোম্পানি খুললে স্ট্যাটাস ডিফল্টভাবে 'Pending' থাকবে (এডমিন অ্যাপ্রুভ করবে পরে)
            createdAt: new Date() // কখন রেজিস্ট্রেশন হলো তার টাইমস্ট্যাম্প
        };
        const result = await req.db.companies.insertOne(newCompany); // কোম্পানি টেবিলে সেভ করা হলো
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error creating company profile" });
    }
});

// এডমিন প্যানেল থেকে কোম্পানির স্ট্যাটাস (Approved / Rejected) পরিবর্তন করা
app.patch("/api/companies/:id", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body; // ফ্রন্টএন্ড থেকে পাঠানো নতুন স্ট্যাটাস (যেমন: Approved)

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid target entity identification metadata ID" });
        }
        if (!updateData?.status) {
            return res.status(400).json({ error: "Action processing system requires status key updates" });
        }

        // কোম্পানির আইডি ম্যাচ করে শুধুমাত্র স্ট্যাটাস ফিল্ডটি আপডেট ($set) করে দেওয়া হলো
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
//                                 🎯 APPLICATIONS
// ==========================================================================

// চাকরিপ্রার্থীদের জবে আবেদন বা নতুন অ্যাপ্লিকেশন সাবমিট করা (Apply Now বাটনে ক্লিক করলে)
app.post("/api/application", async (req, res) => {
    try {
        const data = req.body; // ফ্রন্টএন্ড থেকে আসা ক্যান্ডিডেটের নাম, রিজিউম লিংক ও জব আইডি

        if (!data.jobId || !data.applicantId) {
            return res.status(400).json({ error: "Missing linkage IDs required for application records" });
        }

        const application = {
            ...data,
            createdAt: new Date() // কখন আবেদন করল তার টাইমস্ট্যাম্প
        };
        const result = await req.db.applications.insertOne(application); // অ্যাপ্লিকেশন টেবিলে সেভ হলো
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error posting candidate application" });
    }
});

// আবেদনসমূহ কুয়েরি করে তুলে আনা (কে কোন জবে অ্যাপ্লাই করেছে তার লিস্ট ড্যাশবোর্ডে দেখার জন্য)
app.get("/api/application", async (req, res) => {
    try {
        const query = {};

        if (req.query.applicantId) {
            query.applicantId = req.query.applicantId; // নির্দিষ্ট চাকরিপ্রার্থীর নিজের সব অ্যাপ্লিকেশনের লিস্ট
        }
        if (req.query.userId) {
            query.userId = req.query.userId; // রিক্রুটারের কাছে আসা সব অ্যাপ্লিকেশনের লিস্ট ফিল্টার
        }

        const result = await req.db.applications.find(query).sort({ createdAt: -1 }).toArray(); // লেটেস্ট অ্যাপ্লিকেশন সবার আগে সর্ট করে আনা হলো
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error structural directory sync failed" });
    }
});

// ==========================================================================
//                                 🎯 PLANS
// ==========================================================================

// আইডি ফিল্টার দিয়ে নির্দিষ্ট পেমেন্ট বা সাবস্ক্রিপশন প্ল্যানের ডিটেইলস খুঁজে বের করা (Pricing Page)
app.get("/api/plans", async (req, res) => {
    try {
        const query = {};

        if (req.query.plan_id) {
            query.id = req.query.plan_id; // নির্দিষ্ট প্ল্যানের আইডি ম্যাচিং (যেমন: Silver, Premium, Gold)
        }
        const result = await req.db.plans.findOne(query); // প্ল্যান টেবিল থেকে তথ্য খোঁজা হচ্ছে
        res.json(result || {});
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error fetching subscription directory metrics" });
    }
});

// ==========================================================================
//                               🎯 SUBSCRIPTIONS
// ==========================================================================

// প্রিমিয়াম প্ল্যান কেনা এবং ইউজারের প্রোফাইলে মেম্বারশিপ প্ল্যান আপডেট করা (Transaction Flow)
app.post("/api/subscription", async (req, res) => {
    try {
        const data = req.body; // ফ্রন্টএন্ড থেকে আসা পেমেন্ট ইমেইল এবং প্ল্যান আইডি

        if (!data.email || !data.planId) {
            return res.status(400).json({ error: "Email identity token and core plan tracking codes missing" });
        }

        const subsInfo = {
            ...data,
            createdAt: new Date() // পেমেন্ট বা সাবস্ক্রিপশন কেনার কারেন্ট টাইমস্ট্যাম্প
        };

        // ১. সাবস্ক্রিপশন ট্র্যাকিং লগ বা খাতার ভেতর পেমেন্টের রিসিট ইনসার্ট করা হচ্ছে
        await req.db.subscriptions.insertOne(subsInfo);

        // ২. মেইন ইউজার অবজেক্টের বা অ্যাকাউন্টের মেম্বারশিপ প্ল্যান টাইপ (plan) চট করে আপডেট করে দেওয়া হচ্ছে
        const filter = { email: data.email };
        const updateDocument = {
            $set: { plan: data.planId } // ইউজারের প্রোফাইলে প্ল্যান আইডি সেট হয়ে গেল (যেমন: plan: "premium")
        };

        const updateResult = await req.db.users.updateOne(filter, updateDocument); // ইউজার টেবিলে ডাটা আপডেট করা হলো
        res.json(updateResult); // আপডেটের রেজাল্ট ফ্রন্টএন্ডে পাঠানো হলো
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error deploying membership ledger tokens" });
    }
});

// ==========================================================================
// ⚙️ SYSTEM RUNNERS (Vercel এবং Local উভয়ের জন্য অপ্টিমাইজড)
// ==========================================================================

// রুট বা মেইন ইউআরএল বেস হেলথ চেক পাথ রাউট (সার্ভার অন আছে কি না ব্রাউজারে চেক করার জন্য)
app.get('/', (req, res) => {
    res.send('HireLoop cluster system environment is running active, optimized and clean!');
});

// 🎯 লোকাল পিসির জন্য রানার কন্ট্রোল (ভার্সেলে আপলোড দিলে এই ব্লকটি অটোমেটিক অফ থাকবে যেন ক্র্যাশ না হয়)
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        // console.log(`HireLoop app listening on local port ${port}`); // লোকাল কম্পিউটারে রান হলে এই মেসেজ কনসোলে প্রিন্ট হবে
    });
}

// 🚀 ভার্সেল সার্ভারলেস এনভায়রনমেন্টের জন্য এক্সপ্রেস অ্যাপের সব লজিক মেইন রুট হিসেবে এক্সপোর্ট করে দেওয়া হলো
module.exports = app;