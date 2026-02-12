import dotenv from "dotenv";
dotenv.config();

const allowedOrigins = [
  "http://localhost:5173","https://get-me-a-tutor.vercel.app/","https://getmeatutor.vercel.app/"// frontend
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
  
export default corsOptions;
