const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();
const questionRoutes = require('./routes/questionRoutes');

const app = express();

app.use(express.json());
app.set('trust proxy', true);


// app.use(cors());
app.use(cors({
  //origin: ['https://your-frontend-domain.com', 'http://localhost:3000'], // Allowed origins
  methods: ['GET', 'POST'], // Allowed HTTP methods
  //allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
  //credentials: true // Allow credentials (e.g., cookies, HTTP auth)
}));


app.use('/api/v1', questionRoutes);
app.use(morgan('combined')); 

const PORT = process.env.PORT;


app.listen(PORT, '0.0.0.0', () => {
  console.log(`xAPI Wrapper is running on port ${PORT}`);
});