import mongoose from 'mongoose';

const connectionString = process.env.MONGO_URI; // Replace with your MongoDB connection string

const connectDB = async () => {
  try {
    await mongoose.connect(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
  }
};

export default connectDB;