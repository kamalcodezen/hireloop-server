const express = require('express');
const dotenv = require("dotenv");
const cors = require("cors");
const app = express()
dotenv.config()
const { MongoClient, ServerApiVersion } = require('mongodb');

const port = process.env.PORT
const uri = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json());



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const db = client.db("hire_loop")
        const jobsCollection = db.collection("jobs")
        const companiesCollection = db.collection("companies")
        const userCollection = db.collection("user")


        // user details get
        app.get("/api/user", async (req, res) => {
            const cursor = await userCollection.find()
            const result = await cursor.toArray()
            res.json(result)
        })

        // ======================================
        //               jobs
        //  =====================================

        // get all jobs 
        app.get("/api/jobs", async (req, res) => {
            const cursor = await jobsCollection.find()
            const result = await cursor.toArray()
            res.json(result)
        })

        // jobs get query
        app.get("/api/jobs", async (req, res) => {
            const query = {}
            if (req.query.companyId) {
                query.companyId = req.query.companyId
            }
            if (req.query.status) {
                query.status = req.query.status
            }

            const cursor = await jobsCollection.find(query)
            const result = await cursor.toArray()
            res.json(result)
        })

        // new jobs Create jobs post 
        app.post("/api/jobs", async (req, res) => {
            const jobs = req.body;
            const newJobs = {
                ...jobs,
                createdAt: new Date()
            }
            const result = await jobsCollection.insertOne(newJobs);
            res.json(result)
        })


        // ======================================
        //               companies
        //  =====================================

        // all companies data get
        app.get("/api/companies", async (req, res) => {
            const result = await companiesCollection.find().skip(7).toArray()
            res.json(result)

        })

        // recruiter Id company data get
        app.get("/api/my/companies", async (req, res) => {
            const query = {}
            if (req.query.recruiterId) {
                query.recruiterId = req.query.recruiterId
            }
            const result = await companiesCollection.findOne(query)
            res.json(result || {})
        })


        // Create Companies post companies
        app.post("/api/companies", async (req, res) => {
            const company = req.body
            const newCompany = {
                ...company,
                createdAt: new Date()
            }
            const result = await companiesCollection.insertOne(newCompany)
            res.json(result)
        })








        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('HireLoop is server is running fine!')
})

app.listen(port, () => {
    console.log(`HireLoop app listening on port ${port}`)
})