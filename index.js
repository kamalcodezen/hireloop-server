const express = require('express');
const dotenv = require("dotenv");
const cors = require("cors");
const app = express()
dotenv.config()


const port = process.env.PORT

app.use(cors());
app.use(express.json());




app.get('/', (req, res) => {
    res.send('HireLoop is server is running fine!')
})

app.listen(port, () => {
    console.log(`HireLoop app listening on port ${port}`)
})