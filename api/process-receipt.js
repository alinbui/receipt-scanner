import { GoogleGenerativeAI } from '@google/generative-ai';
import formidable from 'formidable';
import fs from 'fs';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function processReceiptFromBuffer(imageBuffer, mimeType) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    
    const imageBase64 = imageBuffer.toString('base64');
    
    const imageParts = [
      {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType || 'image/jpeg'
        }
      }
    ];
    
    const prompt = `
      Analyze this receipt image and extract all relevant information into a structured JSON format suitable for expense reporting.
      
      Please return a JSON object with the following structure:
      {
        "receipt_info": {
          "merchant_name": "string",
          "address": "string", 
          "date": "YYYY-MM-DD",
          "time": "HH:MM",
          "server": "string",
          "guest_count": number
        },
        "items": [
          {
            "name": "string",
            "quantity": number,
            "unit_price": number,
            "total_price": number,
            "currency": "string"
          }
        ],
        "totals": {
          "subtotal": number,
          "tax": number,
          "total": number,
          "payment_method": "string",
          "payment_amount": number,
          "change": number,
          "currency": "string"
        },
        "expense_category": "string",
        "business_purpose": "string"
      }
      
      For the currency, use the 3-letter ISO code (VND for Vietnamese Dong).
      For expense_category, suggest an appropriate category like "Meals & Entertainment", "Business Meals", etc.
      For business_purpose, suggest a generic purpose like "Business meal" or "Client entertainment".
      
      Extract all numerical values as numbers, not strings.
      Ensure dates are in YYYY-MM-DD format.
    `;
    
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonString = jsonMatch[0];
      const receiptData = JSON.parse(jsonString);
      return receiptData;
    } else {
      throw new Error('Could not extract valid JSON from AI response');
    }
  } catch (error) {
    console.error('Error processing receipt with AI:', error);
    throw error;
  }
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ 
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      keepExtensions: true
    });
    
    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'This endpoint only accepts POST requests' 
    });
  }
  
  try {
    // Check if Google API key is configured
    if (!process.env.GOOGLE_API_KEY) {
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Google API key not configured'
      });
    }
    
    // Parse the multipart form data
    const { fields, files } = await parseForm(req);
    
    // Check if file was uploaded
    if (!files.receipt) {
      return res.status(400).json({
        error: 'Missing file',
        message: 'No receipt image file provided. Please upload a file with the field name "receipt"'
      });
    }
    
    const uploadedFile = Array.isArray(files.receipt) ? files.receipt[0] : files.receipt;
    
    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(uploadedFile.mimetype)) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: 'Please upload a valid image file (JPEG, PNG, or WebP)'
      });
    }
    
    // Read the uploaded file
    const imageBuffer = fs.readFileSync(uploadedFile.filepath);
    
    // Clean up the temporary file
    fs.unlinkSync(uploadedFile.filepath);
    
    // Process the receipt with Gemini AI
    const expenseData = await processReceiptFromBuffer(imageBuffer, uploadedFile.mimetype);
    
    // Return the processed data
    res.status(200).json({
      success: true,
      data: expenseData,
      metadata: {
        originalFilename: uploadedFile.originalFilename,
        fileSize: uploadedFile.size,
        mimeType: uploadedFile.mimetype,
        processedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Receipt processing error:', error);
    
    // Handle specific error types
    if (error.message.includes('API key')) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or expired Google API key'
      });
    }
    
    if (error.message.includes('quota')) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'API quota exceeded. Please try again later'
      });
    }
    
    if (error.message.includes('JSON')) {
      return res.status(422).json({
        error: 'Processing failed',
        message: 'Could not extract structured data from the receipt image'
      });
    }
    
    // Generic error response
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to process receipt. Please try again',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}