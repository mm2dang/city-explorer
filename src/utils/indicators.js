import AWS from 'aws-sdk';
import pako from 'pako';
import Papa from 'papaparse';

// Configure AWS SDK
const s3 = new AWS.S3({
  region: process.env.REACT_APP_AWS_REGION,
  accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
});

// Initialize Glue client
let glue = null;
try {
  // AWS Glue is available in the AWS SDK
  if (AWS.Glue) {
    glue = new AWS.Glue({
      region: process.env.REACT_APP_AWS_REGION,
      accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
    });
  }
} catch (error) {
  console.warn('AWS Glue not available in this SDK version:', error.message);
}

const RESULT_BUCKET = process.env.REACT_APP_S3_RESULT_BUCKET_NAME;
const GLUE_JOB_NAME = 'monthly_indicators';

/**
 * Get available date ranges from S3 summary folder
 */
export async function getAvailableDateRanges(dataSource) {
  try {
    const prefix = `${dataSource}/summary/`;
    
    const params = {
      Bucket: RESULT_BUCKET,
      Prefix: prefix,
      Delimiter: '/'
    };

    const result = await s3.listObjectsV2(params).promise();
    
    // Extract date ranges from folder names
    const dateRanges = result.CommonPrefixes
      .map(prefix => {
        const parts = prefix.Prefix.split('/');
        return parts[parts.length - 2]; // Get the date range folder name
      })
      .filter(range => range.match(/^\d{4}-\d{2}_to_\d{4}-\d{2}$/))
      .sort()
      .reverse(); // Most recent first

    console.log(`Found ${dateRanges.length} date ranges for ${dataSource}:`, dateRanges);
    return dateRanges;
  } catch (error) {
    console.error('Error getting available date ranges:', error);
    throw error;
  }
}

/**
 * Read and decompress a gzipped CSV file from S3
 */
async function readGzippedCsv(bucket, key) {
  try {
    const params = {
      Bucket: bucket,
      Key: key
    };

    const response = await s3.getObject(params).promise();
    
    // Decompress the gzipped content
    const decompressed = pako.ungzip(response.Body, { to: 'string' });
    
    // Parse CSV
    return new Promise((resolve, reject) => {
      Papa.parse(decompressed, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          resolve(results.data);
        },
        error: (error) => {
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error(`Error reading gzipped CSV ${key}:`, error);
    throw error;
  }
}

/**
 * Get summary data for all cities in a date range
 */
export async function getSummaryData(dataSource, dateRange) {
  try {
    const prefix = `${dataSource}/summary/${dateRange}/`;
    
    // List all CSV files in the date range folder
    const params = {
      Bucket: RESULT_BUCKET,
      Prefix: prefix
    };

    const result = await s3.listObjectsV2(params).promise();
    
    // Filter for CSV.gz files
    const csvFiles = result.Contents.filter(obj => 
      obj.Key.endsWith('.csv.gz')
    );

    console.log(`Found ${csvFiles.length} CSV files in ${prefix}`);

    // Read and combine all CSV files
    let allData = [];
    for (const file of csvFiles) {
      try {
        const data = await readGzippedCsv(RESULT_BUCKET, file.Key);
        allData = allData.concat(data);
      } catch (error) {
        console.error(`Error reading file ${file.Key}:`, error);
      }
    }

    console.log(`Loaded ${allData.length} rows of summary data`);
    return allData;
  } catch (error) {
    console.error('Error getting summary data:', error);
    throw error;
  }
}

/**
 * Get monthly indicator data for a specific city
 */
export async function getMonthlyIndicators(dataSource, country, province, city, dateRange) {
  try {
    // Parse date range to get start and end months
    const [startDate, endDate] = dateRange.split('_to_');
    const startMonth = startDate; // e.g., "2024-06"
    const endMonth = endDate; // e.g., "2025-06"

    // Generate list of months in range
    const months = generateMonthRange(startMonth, endMonth);
    
    // Normalize names for S3 paths
    const normalizedCountry = country.toLowerCase().replace(/\s+/g, '_');
    const normalizedProvince = province ? province.toLowerCase().replace(/\s+/g, '_') : '';
    const normalizedCity = city.toLowerCase().replace(/\s+/g, '_');

    const monthlyData = [];

    for (const month of months) {
      try {
        // Construct S3 path
        const prefix = normalizedProvince
          ? `${dataSource}/results/country=${normalizedCountry}/province=${normalizedProvince}/city=${normalizedCity}/month=${month}/`
          : `${dataSource}/results/country=${normalizedCountry}/city=${normalizedCity}/month=${month}/`;

        // List files in this month's folder
        const params = {
          Bucket: RESULT_BUCKET,
          Prefix: prefix
        };

        const result = await s3.listObjectsV2(params).promise();
        
        // Find parquet files
        const parquetFiles = result.Contents?.filter(obj => 
          obj.Key.endsWith('.parquet')
        ) || [];

        if (parquetFiles.length > 0) {
          // For now, we'll use a workaround: convert the indicator summary data
          // In production, you'd read the actual Parquet file
          console.log(`Found ${parquetFiles.length} parquet files for ${month}`);
          
          // Fallback: use summary data
          const summaryData = await getSummaryData(dataSource, dateRange);
          const cityData = summaryData.find(row => 
            row.city.toLowerCase() === city.toLowerCase() &&
            row.country.toLowerCase() === country.toLowerCase() &&
            (!province || row.province.toLowerCase() === province.toLowerCase())
          );

          if (cityData) {
            monthlyData.push({
              month,
              out_at_night: cityData.out_at_night,
              leisure_dwell_time: cityData.leisure_dwell_time,
              cultural_visits: cityData.cultural_visits,
              coverage: cityData.coverage,
              speed: cityData.speed,
              latency: cityData.latency
            });
          }
        }
      } catch (error) {
        console.error(`Error loading data for month ${month}:`, error);
      }
    }

    console.log(`Loaded ${monthlyData.length} months of data for ${city}`);
    return monthlyData;
  } catch (error) {
    console.error('Error getting monthly indicators:', error);
    throw error;
  }
}

/**
 * Generate array of months between start and end (inclusive)
 */
function generateMonthRange(startMonth, endMonth) {
  const months = [];
  const [startYear, startMon] = startMonth.split('-').map(Number);
  const [endYear, endMon] = endMonth.split('-').map(Number);

  let currentYear = startYear;
  let currentMonth = startMon;

  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMon)) {
    const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    months.push(monthStr);

    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }

  return months;
}

/**
 * Trigger the Glue job to recalculate indicators
 */
export async function triggerGlueJob() {
  if (!glue) {
    throw new Error('AWS Glue is not available. Please ensure the AWS SDK includes Glue support.');
  }

  try {
    const params = {
      JobName: GLUE_JOB_NAME
    };

    const result = await glue.startJobRun(params).promise();
    console.log('Started Glue job:', result.JobRunId);
    return result.JobRunId;
  } catch (error) {
    console.error('Error triggering Glue job:', error);
    throw error;
  }
}

/**
 * Get the status of a Glue job run
 */
export async function getGlueJobStatus(jobRunId) {
  if (!glue) {
    throw new Error('AWS Glue is not available. Please ensure the AWS SDK includes Glue support.');
  }

  try {
    const params = {
      JobName: GLUE_JOB_NAME,
      RunId: jobRunId
    };

    const result = await glue.getJobRun(params).promise();
    const jobRun = result.JobRun;

    return {
      state: jobRun.JobRunState,
      startedOn: jobRun.StartedOn,
      completedOn: jobRun.CompletedOn,
      executionTime: jobRun.ExecutionTime,
      errorMessage: jobRun.ErrorMessage,
      progress: calculateProgress(jobRun),
      message: getStatusMessage(jobRun)
    };
  } catch (error) {
    console.error('Error getting Glue job status:', error);
    throw error;
  }
}

/**
 * Calculate progress percentage from job run state
 */
function calculateProgress(jobRun) {
  const state = jobRun.JobRunState;
  
  switch (state) {
    case 'STARTING':
      return 10;
    case 'RUNNING':
      // Estimate progress based on execution time if available
      if (jobRun.ExecutionTime && jobRun.Timeout) {
        return Math.min(90, 10 + (jobRun.ExecutionTime / jobRun.Timeout) * 80);
      }
      return 50;
    case 'SUCCEEDED':
      return 100;
    case 'FAILED':
    case 'STOPPED':
      return 0;
    default:
      return 0;
  }
}

/**
 * Get human-readable status message
 */
function getStatusMessage(jobRun) {
  const state = jobRun.JobRunState;
  
  switch (state) {
    case 'STARTING':
      return 'Initializing calculation job...';
    case 'RUNNING':
      if (jobRun.ExecutionTime) {
        const minutes = Math.floor(jobRun.ExecutionTime / 60);
        return `Processing data... (${minutes} min elapsed)`;
      }
      return 'Processing data...';
    case 'SUCCEEDED':
      return 'Calculation completed successfully!';
    case 'FAILED':
      return jobRun.ErrorMessage || 'Calculation failed';
    case 'STOPPED':
      return 'Calculation was stopped';
    default:
      return state;
  }
}