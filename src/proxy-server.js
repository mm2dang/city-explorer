const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3001;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// World Bank API proxy endpoint
app.get('/api/worldbank/:countryCode', async (req, res) => {
    const { countryCode } = req.params;
    
    try {
      const apiUrl = `https://api.worldbank.org/v2/country/${countryCode}/indicator/IT.CEL.SETS.P2?format=json&per_page=50&date=2000:2023`;
      
      console.log(`Fetching World Bank data for ${countryCode}...`);
      console.log(`URL: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        }
      });
  
      if (!response.ok) {
        console.error(`World Bank API returned status ${response.status}`);
        return res.json({ countryCode, value: 0, values: [], message: `API error: ${response.status}` });
      }
  
      const text = await response.text();
      
      if (text.startsWith('<?xml') || text.includes('<html')) {
        console.error('Received XML/HTML instead of JSON');
        return res.json({ countryCode, value: 0, values: [], message: 'API returned non-JSON response' });
      }
  
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('Failed to parse JSON:', parseError.message);
        return res.json({ countryCode, value: 0, values: [], message: 'Invalid JSON response' });
      }
  
      if (!data || !Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) {
        console.log('No data available in response structure');
        return res.json({ countryCode, value: 0, values: [], message: 'No data available' });
      }
  
      const records = data[1];
      console.log(`Found ${records.length} records`);
      
      // Get all valid values for historical chart
      const allValues = records
        .filter(record => record.value !== null && !isNaN(record.value) && record.value > 0)
        .map(record => ({
          year: record.date,
          value: parseFloat(record.value)
        }))
        .sort((a, b) => a.year - b.year);
  
      // Get most recent value for S3 storage
      let mostRecentValue = 0;
      let mostRecentYear = null;
      
      for (const record of records) {
        if (record.value !== null && !isNaN(record.value)) {
          mostRecentValue = parseFloat(record.value);
          mostRecentYear = record.date;
          console.log(`✓ Most recent value: ${mostRecentValue} for year ${mostRecentYear}`);
          break;
        }
      }
  
      console.log(`✓ Returning most recent: ${mostRecentValue}%, historical: ${allValues.length} values`);
      
      res.json({
        countryCode,
        value: mostRecentValue, 
        year: mostRecentYear,
        values: allValues,
        count: allValues.length
      });
      
    } catch (error) {
      console.error('Error fetching World Bank data:', error.message);
      console.error('Stack:', error.stack);
      res.status(500).json({ error: error.message });
    }
  });

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`✓ Proxy server running on http://localhost:${PORT}`);
  console.log(`  Proxying World Bank API requests`);
  console.log(`  Example: http://localhost:${PORT}/api/worldbank/USA`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
});