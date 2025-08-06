import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

async function processReceiptToJSON(imagePath) {
  // Initialize the Google Generative AI client
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  
  // Get the generative model
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
  
  // Read the image file
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  
  const imageParts = [
    {
      inlineData: {
        data: imageBase64,
        mimeType: 'image/jpeg'
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
  
  try {
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from the response (remove markdown code blocks if present)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonString = jsonMatch[0];
      const receiptData = JSON.parse(jsonString);
      return receiptData;
    } else {
      throw new Error('Could not extract valid JSON from response');
    }
  } catch (error) {
    console.error('Error processing receipt:', error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    const receiptPath = './receipt1.jpg';
    console.log('Processing receipt:', receiptPath);
    
    const expenseData = await processReceiptToJSON(receiptPath);
    
    console.log('\n=== EXPENSE REPORT JSON ===');
    console.log(JSON.stringify(expenseData, null, 2));
    
    // Save to file
    const outputPath = './expense-report.json';
    fs.writeFileSync(outputPath, JSON.stringify(expenseData, null, 2));
    console.log(`\nExpense report saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('Failed to process receipt:', error.message);
  }
}

// Export for use as module
export { processReceiptToJSON };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}