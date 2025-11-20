import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getAvailableDateRanges,
  getAvailableConnectivityDateRanges,
  getSummaryDataWithConnectivity,
  getGlueJobStatus,
  getMonthlyIndicatorData,
  getQuarterlyConnectivityData
} from '../utils/indicators';
import Papa from 'papaparse';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import '../styles/IndicatorsSidebar.css';
import { getCountryCode } from '../utils/connectivity';

const IndicatorsSidebar = ({ 
  selectedCity, 
  dataSource, 
  onCalculateIndicators, 
  cities,
  connectivityProgress,
  isCalculatingConnectivity,
  onCancelConnectivity,
  onConnectivityProgressUpdate,
  onConnectivityStateChange,
  isCollapsed,
  onToggleCollapse
}) => {
  const [selectedDateRange, setSelectedDateRange] = useState(null);
  const [availableDateRanges, setAvailableDateRanges] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'city', direction: 'asc' });
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationStatus, setCalculationStatus] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedIndicator, setExpandedIndicator] = useState(null);
  const [timeSeriesData, setTimeSeriesData] = useState({});
  const [loadingTimeSeries, setLoadingTimeSeries] = useState({});
  const [dateRangeStats, setDateRangeStats] = useState({});
  const [showDateRangeDropdown, setShowDateRangeDropdown] = useState(false);
  const [showDateRangeStats, setShowDateRangeStats] = useState(true);

  // Indicator definitions with labels and descriptions
  const indicators = useMemo(() => ({
    out_at_night: {
      label: 'Out at Night',
      description: 'Proportion of people seen after dark',
      color: '#8b5cf6',
      unit: '%',
      icon: 'fa-moon',
      type: 'mobile_ping',
      frequency: 'monthly'
    },
    leisure_dwell_time: {
      label: 'Leisure Time',
      description: 'Total dwell time in cultural or recreational sites',
      color: '#10b981',
      unit: 'min',
      icon: 'fa-clock',
      type: 'mobile_ping',
      frequency: 'monthly'
    },
    cultural_visits: {
      label: 'Cultural Visits',
      description: 'Median number of visits to cultural or recreational sites per month',
      color: '#f59e0b',
      unit: 'visits',
      icon: 'fa-palette',
      type: 'mobile_ping',
      frequency: 'monthly'
    },
    coverage: {
      label: 'Coverage',
      description: 'Mobile phone subscriptions per 100 people (country-wide)',
      color: '#3b82f6',
      unit: '%',
      icon: 'fa-signal',
      type: 'connectivity',
      frequency: 'quarterly'
    },
    speed: {
      label: 'Speed',
      description: 'Mobile internet download speed',
      color: '#ef4444',
      unit: 'kbps',
      icon: 'fa-tachometer-alt',
      type: 'connectivity',
      frequency: 'quarterly'
    },
    latency: {
      label: 'Latency',
      description: 'Mobile internet download latency',
      color: '#ec4899',
      unit: 'ms',
      icon: 'fa-stopwatch',
      type: 'connectivity',
      frequency: 'quarterly'
    }
  }), []);

  // Load calculation statistics for each date range
  const loadDateRangeStats = useCallback(async (dateRanges) => {
    const stats = {};
    
    for (const range of dateRanges) {
      try {
        const data = await getSummaryDataWithConnectivity(dataSource, range, cities || []);
        
        // Filter to only include cities that exist in the cities array
        const cityNames = new Set((cities || []).map(c => c.name.toLowerCase()));
        const filteredData = data.filter(row => {
          const fullName = [row.city, row.province, row.country]
            .filter(Boolean)
            .join(', ')
            .toLowerCase();
          return cityNames.has(fullName);
        });
        
        // Count statuses - Check for actual values, not just null
        let calculated = 0;
        let notCalculated = 0;
        let connectivityOnly = 0;
        let mobilePingOnly = 0;
        
        filteredData.forEach(row => {
          // Check for actual non-null, non-zero values
          const hasMobilePing = (
            (row.out_at_night != null && !isNaN(row.out_at_night)) || 
            (row.leisure_dwell_time != null && !isNaN(row.leisure_dwell_time)) || 
            (row.cultural_visits != null && !isNaN(row.cultural_visits))
          );
          
          // For connectivity, check if speed OR latency exist (not coverage, as it might be 0)
          const hasConnectivity = (
            (row.speed != null && !isNaN(row.speed)) || 
            (row.latency != null && !isNaN(row.latency))
          );
          
          // Also include coverage if it exists and is not null
          const hasCoverage = row.coverage != null && !isNaN(row.coverage);
          const hasAnyConnectivity = hasConnectivity || hasCoverage;
          
          console.log(`[Stats] ${row.city}: mobilePing=${hasMobilePing}, connectivity=${hasAnyConnectivity}`, {
            out_at_night: row.out_at_night,
            leisure_dwell_time: row.leisure_dwell_time,
            cultural_visits: row.cultural_visits,
            speed: row.speed,
            latency: row.latency,
            coverage: row.coverage
          });
          
          if (hasMobilePing && hasAnyConnectivity) {
            calculated++;
          } else if (hasAnyConnectivity) {
            connectivityOnly++;
          } else if (hasMobilePing) {
            mobilePingOnly++;
          } else {
            notCalculated++;
          }
        });
        
        stats[range] = {
          calculated,
          notCalculated,
          connectivityOnly,
          mobilePingOnly,
          total: filteredData.length
        };
        
        console.log(`[Stats] Range ${range}:`, stats[range]);
      } catch (error) {
        console.error(`Error loading stats for ${range}:`, error);
        stats[range] = {
          calculated: 0,
          notCalculated: 0,
          connectivityOnly: 0,
          mobilePingOnly: 0,
          total: 0
        };
      }
    }
    
    return stats;
  }, [dataSource, cities]);

  // Load available date ranges
  const loadDateRanges = useCallback(async () => {
    try {
      // Load both Glue results and connectivity results date ranges
      const [glueRanges, connectivityRanges] = await Promise.all([
        getAvailableDateRanges(dataSource).catch(() => []),
        getAvailableConnectivityDateRanges(dataSource).catch(() => [])
      ]);
      
      // Merge and deduplicate
      const allRanges = [...new Set([...glueRanges, ...connectivityRanges])].sort().reverse();
      
      setAvailableDateRanges(allRanges);
      if (allRanges.length > 0 && !selectedDateRange) {
        setSelectedDateRange(allRanges[0]); // Select most recent by default
      }
      
      // Load statistics for each date range
      if (allRanges.length > 0) {
        const stats = await loadDateRangeStats(allRanges);
        setDateRangeStats(stats);
      }
    } catch (error) {
      console.error('Error loading date ranges:', error);
    }
  }, [dataSource, selectedDateRange, loadDateRangeStats]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showDateRangeDropdown && !event.target.closest('.date-range-selector')) {
        setShowDateRangeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDateRangeDropdown]);

  // Load summary data
  const loadSummaryData = useCallback(async () => {
    if (!selectedDateRange) return;
    setIsLoading(true);
    try {
      // Pass cities from props instead of empty array
      const data = await getSummaryDataWithConnectivity(dataSource, selectedDateRange, cities || []);
      
      // Filter to only include cities that exist in the cities array
      const cityNames = new Set((cities || []).map(c => c.name.toLowerCase()));
      const filteredData = data.filter(row => {
        const fullName = [row.city, row.province, row.country]
          .filter(Boolean)
          .join(', ')
          .toLowerCase();
        return cityNames.has(fullName);
      });
      
      setSummaryData(filteredData);
    } catch (error) {
      console.error('Error loading summary data:', error);
      setSummaryData([]);
    } finally {
      setIsLoading(false);
    }
  }, [dataSource, selectedDateRange, cities]);

  // Load available date ranges on mount or when data source changes
  useEffect(() => {
    loadDateRanges();
  }, [dataSource, loadDateRanges]);

  // Load summary data when date range changes
  useEffect(() => {
    if (selectedDateRange) {
      loadSummaryData();
    }
  }, [selectedDateRange, loadSummaryData]);

  // Clear time series data when selected city changes
  useEffect(() => {
    setTimeSeriesData({});
    setLoadingTimeSeries({});
    setExpandedIndicator(null);
  }, [selectedCity]);

  // Poll for job status when calculating
  useEffect(() => {
    let intervalId;
    if (isCalculating && jobId) {
      intervalId = setInterval(async () => {
        try {
          const status = await getGlueJobStatus(jobId);
          setCalculationStatus(status);
          if (status.state === 'SUCCEEDED') {
            setIsCalculating(false);
            setJobId(null);
            // Reload data after successful calculation
            await loadDateRanges();
            if (selectedDateRange) {
              await loadSummaryData();
            }
            // Show success message
            alert('Indicator calculation completed successfully!');
          } else if (status.state === 'FAILED' || status.state === 'STOPPED') {
            setIsCalculating(false);
            setJobId(null);
            alert(`Calculation ${status.state.toLowerCase()}: ${status.errorMessage || 'Unknown error'}`);
          }
        } catch (error) {
          console.error('Error polling job status:', error);
          setIsCalculating(false);
          setJobId(null);
          alert(`Error checking job status: ${error.message}`);
        }
      }, 5000); // Poll every 5 seconds
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isCalculating, jobId, selectedDateRange, loadDateRanges, loadSummaryData]);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportMenu && !event.target.closest('.export-menu-wrapper')) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  useEffect(() => {
    const handleConnectivityProgress = (e) => {
      console.log('Connectivity progress event received:', e.detail);
      // Update the connectivity progress state from the event
      if (e.detail && onConnectivityProgressUpdate) {
        onConnectivityProgressUpdate(e.detail);
      }
    };

    const handleConnectivityComplete = () => {
      console.log('Connectivity complete event received');
      // Clear connectivity calculation state
      if (onConnectivityStateChange) {
        onConnectivityStateChange(false);
      }
      if (onConnectivityProgressUpdate) {
        onConnectivityProgressUpdate(null);
      }
      // Reload data
      loadDateRanges();
      if (selectedDateRange) {
        loadSummaryData();
      }
    };

    window.addEventListener('connectivity-progress', handleConnectivityProgress);
    window.addEventListener('connectivity-complete', handleConnectivityComplete);

    return () => {
      window.removeEventListener('connectivity-progress', handleConnectivityProgress);
      window.removeEventListener('connectivity-complete', handleConnectivityComplete);
    };
  }, [selectedDateRange, loadDateRanges, loadSummaryData, onConnectivityProgressUpdate, onConnectivityStateChange]);

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedData = useMemo(() => {
    let filtered = [...summaryData];
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(row =>
        Object.values(row).some(val =>
          String(val).toLowerCase().includes(query)
        )
      );
    }
    // Apply sorting
    filtered.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return filtered;
  }, [summaryData, searchQuery, sortConfig]);

  // Get city data for the selected city
  const selectedCityData = useMemo(() => {
    if (!selectedCity || summaryData.length === 0) return null;
    const cityParts = selectedCity.name.split(',').map(p => p.trim());
    let city, province, country;
    if (cityParts.length === 2) {
      [city, country] = cityParts;
      province = '';
    } else {
      [city, province, country] = cityParts;
    }
    return summaryData.find(row =>
      row.city.toLowerCase() === city.toLowerCase() &&
      row.country.toLowerCase() === country.toLowerCase() &&
      (!province || (row.province && row.province.toLowerCase() === province.toLowerCase()))
    );
  }, [selectedCity, summaryData]);

  // Check if export should be enabled
  const canExport = useMemo(() => {
    if (summaryData.length === 0) return false;
    
    const indicatorKeys = Object.keys(indicators);
    
    // If a city is selected, check if that city has valid indicator data
    if (selectedCity) {
      // If selectedCityData is null, no data is available for this city
      if (!selectedCityData) return false;
      
      return indicatorKeys.some(key => 
        selectedCityData[key] != null && !isNaN(selectedCityData[key])
      );
    }
    
    // If no city is selected, check if any city has at least one valid indicator value
    return summaryData.some(row => 
      indicatorKeys.some(key => row[key] != null && !isNaN(row[key]))
    );
  }, [summaryData, indicators, selectedCity, selectedCityData]);

  const handleExportIndicators = async (format) => {
    if (!canExport) return;
  
    try {
      setIsExporting(true);
      setShowExportMenu(false);
  
      let dataToExport = selectedCity ? [selectedCityData] : filteredAndSortedData;
      
      if (!dataToExport || dataToExport.length === 0) {
        throw new Error('No data available to export');
      }
  
      const filename = selectedCity
        ? `${selectedCity.name.replace(/[^a-z0-9]/gi, '_')}_indicators_${selectedDateRange}`
        : `all_cities_indicators_${selectedDateRange}`;
  
      if (format === 'csv') {
        // Export as CSV using Papa Parse
        const csv = Papa.unparse(dataToExport);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log('CSV export completed');
      } else if (format === 'json') {
        // Export as JSON
        const jsonContent = JSON.stringify(dataToExport, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log('JSON export completed');
      } else if (format === 'parquet') {
        // Export as Parquet using parquet-wasm
        const { default: init } = await import('parquet-wasm');
        await init();
  
        // Convert data to Arrow Table format
        const columns = {};
        if (dataToExport.length > 0) {
          Object.keys(dataToExport[0]).forEach(key => {
            columns[key] = dataToExport.map(row => row[key]);
          });
        }
  
        const { tableFromArrays, tableToIPC } = await import('apache-arrow');
        const arrowTable = tableFromArrays(columns);
        const ipcBuffer = tableToIPC(arrowTable, 'stream');
  
        const { Table, writeParquet, WriterPropertiesBuilder, Compression } = await import('parquet-wasm');
        const wasmTable = Table.fromIPCStream(ipcBuffer);
  
        // Write with Snappy compression
        const writerProperties = new WriterPropertiesBuilder()
          .setCompression(Compression.SNAPPY)
          .build();
        const buffer = writeParquet(wasmTable, writerProperties);
  
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.snappy.parquet`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log('Parquet export completed');
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Failed to export indicators: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Render collapsed view when sidebar is collapsed and city is selected
  const renderCollapsedView = () => {
    if (!selectedCityData) {
      return (
        <div className="collapsed-indicators-view">
          <div className="no-data-icon">
            <i className="fas fa-chart-line"></i>
          </div>
        </div>
      );
    }
    
    // Filter to only show indicators with available data
    const availableIndicators = Object.entries(indicators).filter(([key]) => {
      const value = selectedCityData[key];
      return value != null && !isNaN(value);
    });
    
    if (availableIndicators.length === 0) {
      return (
        <div className="collapsed-indicators-view">
          <div className="no-data-icon">
            <i className="fas fa-chart-line"></i>
          </div>
        </div>
      );
    }
    
    return (
      <div className="collapsed-indicators-view">
        {availableIndicators.map(([key, info]) => {
          const value = selectedCityData[key];
          return (
            <motion.div
              key={key}
              className="collapsed-indicator-item"
              title={`${info.label}: ${Number(value).toFixed(2)} ${info.unit}`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <div
                className="collapsed-indicator-icon"
                style={{ background: info.color }}
              >
                <i className={`fas ${info.icon}`}></i>
              </div>
              <span className="collapsed-indicator-value" style={{ color: info.color }}>
                {Number(value).toFixed(1)}
              </span>
            </motion.div>
          );
        })}
      </div>
    );
  };

  const renderIndicatorCards = () => {
    if (!selectedCityData) {
      return (
        <div className="no-data-message">
          <i className="fas fa-chart-line"></i>
          <h3>No Data Available</h3>
          <p>No indicator data found for {selectedCity.name}</p>
        </div>
      );
    }
    
    // Filter to only show indicators with available data
    const availableIndicators = Object.entries(indicators).filter(([key]) => {
      const value = selectedCityData[key];
      return value != null && !isNaN(value);
    });
    
    if (availableIndicators.length === 0) {
      return (
        <div className="no-data-message">
          <i className="fas fa-chart-line"></i>
          <h3>No Data Available</h3>
          <p>No indicator data found for {selectedCity.name}</p>
        </div>
      );
    }
    
    return (
      <div className="indicator-cards-container">
        {availableIndicators.map(([key, info], index) => {
          const value = selectedCityData[key];
          const hasValue = value != null && !isNaN(value);
          const isExpanded = expandedIndicator === key;
          const isLoading = loadingTimeSeries[key];
          const chartData = timeSeriesData[key] || [];
          
          return (
            <motion.div
              key={key}
              className="indicator-card"
              style={{ '--card-color': info.color }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              whileHover={{ scale: 1.02 }}
              onClick={() => handleIndicatorClick(key)}
            >
              <div className="indicator-card-header">
                <div
                  className="indicator-icon"
                  style={{ background: info.color }}
                >
                  <i className={`fas ${info.icon}`}></i>
                </div>
                <div className="indicator-info">
                  <h4>{info.label}</h4>
                  <p>{info.description}</p>
                </div>
                <div className="expand-indicator">
                  <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                </div>
              </div>
              <div className="indicator-card-value">
                <span className="value" style={{ color: info.color }}>
                  {hasValue ? Number(value).toFixed(2) : '-'}
                </span>
                <span className="unit">{info.unit}</span>
                <button
                  className="copy-value-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!hasValue) return;
                    
                    navigator.clipboard.writeText(Number(value).toFixed(2));
                    const btn = e.currentTarget;
                    const icon = btn.querySelector('i');
                    const originalClass = icon.className;
                    
                    icon.className = 'fas fa-check';
                    setTimeout(() => {
                      icon.className = originalClass;
                    }, 1500);
                  }}
                  title="Copy value"
                  disabled={!hasValue}
                >
                  <i className="fas fa-copy"></i>
                </button>
              </div>
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    className="indicator-chart"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {isLoading ? (
                      <div className="chart-loading">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Loading time series...</span>
                      </div>
                    ) : chartData.length === 0 ? (
                      <div className="chart-no-data">
                        <i className="fas fa-chart-line"></i>
                        <span>No time series data available</span>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis 
                            dataKey={
                              key === 'coverage' 
                                ? 'year' 
                                : (info.frequency === 'monthly' ? 'month' : 'quarter')
                            }
                            tick={{ fontSize: 11 }}
                            stroke="#9ca3af"
                          />
                          <YAxis 
                            tick={{ fontSize: 11 }}
                            stroke="#9ca3af"
                          />
                          <Tooltip 
                            contentStyle={{
                              background: 'white',
                              border: '1px solid #e5e7eb',
                              borderRadius: '6px',
                              fontSize: '12px'
                            }}
                            formatter={(value) => [Number(value).toFixed(2) + ' ' + info.unit, info.label]}
                            labelFormatter={(label) => {
                              if (key === 'coverage') {
                                return `Year: ${label}`;
                              }
                              return label;
                            }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="value" 
                            stroke={info.color}
                            strokeWidth={2}
                            dot={{ fill: info.color, r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    );
  };

  const renderSummaryTable = () => {
    if (summaryData.length === 0) {
      return (
        <div className="no-data-message">
          <i className="fas fa-chart-line"></i>
          <h3>No Data Available</h3>
          <p>Select a date range to view indicator data</p>
        </div>
      );
    }
    
    // Filter out indicator columns where ALL values are null
    const visibleIndicators = Object.keys(indicators).filter(key => {
      return summaryData.some(row => row[key] != null && !isNaN(row[key]));
    });
    
    return (
      <div className="summary-table-container">
        <div className="search-container">
          <i className="fas fa-search search-icon"></i>
          <input
            type="text"
            className="search-input"
            placeholder="Search any field..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="clear-search-btn"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              <i className="fas fa-times"></i>
            </button>
          )}
        </div>
        <div className="table-scroll-wrapper">
          <table className="summary-table">
            <thead>
              <tr>
                {['city', 'province', 'country', ...visibleIndicators].map(key => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className={sortConfig.key === key ? 'sorted' : ''}
                  >
                    <div className="th-content">
                      <span>{indicators[key]?.label || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                      {sortConfig.key === key && (
                        <i className={`fas fa-chevron-${sortConfig.direction === 'asc' ? 'up' : 'down'}`}></i>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedData.map((row, index) => (
                <tr key={index}>
                  <td className="city-cell">{row.city}</td>
                  <td>{row.province || '-'}</td>
                  <td>{row.country}</td>
                  {visibleIndicators.map(indicator => (
                    <td key={indicator} className="number-cell">
                      {row[indicator] != null ? Number(row[indicator]).toFixed(2) : '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const parseSelectedCityName = (fullName) => {
    const parts = fullName.split(',').map(p => p.trim());
    if (parts.length === 2) {
      return { city: parts[0], province: '', country: parts[1] };
    }
    return { city: parts[0], province: parts[1], country: parts[2] };
  };

  const fetchHistoricalCoverage = async (country) => {
    try {
      const countryCode = getCountryCode(country);
      if (!countryCode) {
        console.warn('No country code found for:', country);
        return [];
      }
  
      const proxyUrl = `http://localhost:3001/api/worldbank/${countryCode}`;
      console.log(`[Coverage] Fetching historical data for ${country} (${countryCode})...`);
      
      const response = await fetch(proxyUrl);
      const data = await response.json();
      
      if (data.error) {
        console.error(`[Coverage] Error for ${countryCode}:`, data.error);
        return [];
      }
      
      const wbUrl = `https://api.worldbank.org/v2/country/${countryCode}/indicator/IT.CEL.SETS.P2?format=json&per_page=50&date=2000:2023`;
      
      const wbResponse = await fetch(wbUrl);
      const text = await wbResponse.text();
      
      let wbData;
      try {
        wbData = JSON.parse(text);
      } catch (parseError) {
        console.error('Failed to parse World Bank response:', parseError);
        return [];
      }
  
      if (!wbData || !Array.isArray(wbData) || wbData.length < 2 || !Array.isArray(wbData[1])) {
        console.log('No historical data available');
        return [];
      }
  
      const records = wbData[1];
      const historicalData = records
        .filter(record => record.value !== null && !isNaN(record.value) && record.value > 0)
        .map(record => ({
          year: record.date,
          value: parseFloat(record.value)
        }))
        .sort((a, b) => a.year - b.year);
  
      console.log(`[Coverage] Found ${historicalData.length} historical data points`);
      return historicalData;
    } catch (error) {
      console.error('[Coverage] Error fetching historical data:', error);
      return [];
    }
  };

  const handleIndicatorClick = async (indicatorKey) => {
    if (!selectedCity || !selectedDateRange) return;
    
    // Toggle collapse if already expanded
    if (expandedIndicator === indicatorKey) {
      setExpandedIndicator(null);
      return;
    }
    
    setExpandedIndicator(indicatorKey);
    
    // Check if data already loaded
    if (timeSeriesData[indicatorKey]) return;
    
    setLoadingTimeSeries(prev => ({ ...prev, [indicatorKey]: true }));
    
    try {
      const indicator = indicators[indicatorKey];
      const { city, province, country } = parseSelectedCityName(selectedCity.name);
      
      let data;
      
      // Special handling for coverage indicator
      if (indicatorKey === 'coverage') {
        console.log(`[Coverage] Fetching historical data for ${country}...`);
        data = await fetchHistoricalCoverage(country);
        console.log('[Coverage] Historical data:', data);
      } else if (indicator.type === 'mobile_ping') {
        data = await getMonthlyIndicatorData(
          dataSource,
          country,
          province,
          city,
          indicatorKey,
          selectedDateRange
        );
      } else {
        data = await getQuarterlyConnectivityData(
          country,
          province,
          city,
          indicatorKey,
          selectedDateRange
        );
      }
      
      setTimeSeriesData(prev => ({ ...prev, [indicatorKey]: data }));
    } catch (error) {
      console.error('Error loading time series:', error);
      alert(`Failed to load time series data: ${error.message}`);
    } finally {
      setLoadingTimeSeries(prev => ({ ...prev, [indicatorKey]: false }));
    }
  };

  return (
    <motion.div
      className={`indicators-sidebar ${isCollapsed ? 'collapsed' : ''}`}
      animate={{ width: isCollapsed ? 80 : 400 }}
      transition={{ duration: 0.3 }}
    >
      <div className="indicators-header">
        {!isCollapsed && (
          <div className="header-content">
            <div className="header-text">
              <h2>Indicators</h2>
              {selectedCity && <span className="data-source-badge">{dataSource.toUpperCase()}</span>}
            </div>
          </div>
        )}
        <motion.button
          className="collapse-toggle-btn"
          onClick={onToggleCollapse}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`fas fa-chevron-${isCollapsed ? 'left' : 'right'}`}></i>
        </motion.button>
      </div>
      {isCollapsed ? (
        selectedCity ? (
          renderCollapsedView()
        ) : (
          <div className="collapsed-indicators-view">
            <div className="collapsed-stat-item">
              <div className="collapsed-stat-icon" style={{ color: '#06b6d4' }}>
                <i className="fas fa-database"></i>
              </div>
              <div className="collapsed-stat-value">{availableDateRanges.length}</div>
              <div className="collapsed-stat-label">Periods</div>
            </div>
            
            <div className="collapsed-stat-item">
              <div className="collapsed-stat-icon" style={{ color: '#06b6d4' }}>
                <i className="fas fa-city"></i>
              </div>
              <div className="collapsed-stat-value">{summaryData.length}</div>
              <div className="collapsed-stat-label">Cities</div>
            </div>
            
            <div className="collapsed-stat-item">
              <div className="collapsed-stat-icon" style={{ color: '#06b6d4' }}>
                <i className="fas fa-chart-line"></i>
              </div>
              <div className="collapsed-stat-value">
                {Object.keys(indicators).length}
              </div>
              <div className="collapsed-stat-label">Metrics</div>
            </div>
          </div>
        )
      ) : (
        <div className="indicators-content">
          <div className="indicators-scroll-content">
            <div className="controls-section">
              <div className="controls-buttons">
                <button
                  className="calculate-btn"
                  onClick={() => onCalculateIndicators()}
                  disabled={isCalculating || isCalculatingConnectivity}
                >
                  <i className={`fas ${(isCalculating || isCalculatingConnectivity) ? 'fa-spinner fa-spin' : 'fa-calculator'}`}></i>
                  {(isCalculating || isCalculatingConnectivity) ? 'Calculating...' : 'Calculate Indicators'}
                </button>
                {canExport && (
                  <div className="export-menu-wrapper">
                    <button
                      className="export-btn"
                      onClick={() => setShowExportMenu(!showExportMenu)}
                      disabled={isExporting}
                    >
                      <i className={`fas ${isExporting ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                      {isExporting ? 'Exporting...' : 'Export'}
                    </button>
                    {showExportMenu && (
                      <div className="export-dropdown">
                        <button
                          className="export-option"
                          onClick={() => handleExportIndicators('csv')}
                        >
                          <i className="fas fa-file-csv"></i>
                          <span className="format-label">CSV</span>
                          <span className="format-ext">.csv</span>
                        </button>
                        <button
                          className="export-option"
                          onClick={() => handleExportIndicators('json')}
                        >
                          <i className="fas fa-file-code"></i>
                          <span className="format-label">JSON</span>
                          <span className="format-ext">.json</span>
                        </button>
                        <button
                          className="export-option"
                          onClick={() => handleExportIndicators('parquet')}
                        >
                          <i className="fas fa-database"></i>
                          <span className="format-label">Parquet</span>
                          <span className="format-ext">.parquet</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {/* Show Glue job status */}
              {isCalculating && calculationStatus && (
                <div className="calculation-status">
                  <div className="status-header">
                    <i className="fas fa-cog fa-spin"></i>
                    <span>Mobile Ping Calculation</span>
                  </div>
                  <div className="status-bar">
                    <div
                      className="status-fill"
                      style={{ width: `${calculationStatus.progress || 0}%` }}
                    />
                  </div>
                  <small>{calculationStatus.state}: {calculationStatus.message || 'Processing...'}</small>
                </div>
              )}
              
              {/* Show connectivity calculation status */}
              {isCalculatingConnectivity && connectivityProgress && (
                <div className="calculation-status connectivity-status">
                  <div className="status-header">
                    <span>Connectivity Calculation</span>
                    <button 
                      className="cancel-connectivity-btn"
                      onClick={onCancelConnectivity}
                      title="Cancel connectivity calculation"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  <div className="status-bar">
                    <div
                      className="status-fill"
                      style={{ 
                        width: `${Math.round((connectivityProgress.current / connectivityProgress.total) * 100)}%`
                      }}
                    />
                  </div>
                  <small>
                    Processing {connectivityProgress.current} of {connectivityProgress.total} cities
                    {connectivityProgress.currentCity && ` - ${connectivityProgress.currentCity}`}
                  </small>
                  {connectivityProgress.currentProgress && connectivityProgress.currentProgress.message && (
                    <small className="sub-progress">{connectivityProgress.currentProgress.message}</small>
                  )}
                </div>
              )}
              
              <div className="date-range-selector">
                <div className="date-range-header">
                  <label>Date Range</label>
                  {!selectedCity && selectedDateRange && dateRangeStats[selectedDateRange] && (
                    <button
                      className="toggle-stats-btn"
                      onClick={() => setShowDateRangeStats(!showDateRangeStats)}
                      title={showDateRangeStats ? "Hide statistics" : "Show statistics"}
                    >
                      <i className={`fas fa-chevron-${showDateRangeStats ? 'up' : 'down'}`}></i>
                    </button>
                  )}
                </div>
                
                <div className="date-range-dropdown-wrapper">
                  <button
                    className="date-range-selector-btn"
                    onClick={() => setShowDateRangeDropdown(!showDateRangeDropdown)}
                    disabled={isLoading || availableDateRanges.length === 0}
                  >
                    <span>
                      {selectedDateRange 
                        ? selectedDateRange.replace('_to_', ' to ')
                        : availableDateRanges.length === 0 
                          ? 'No date ranges available' 
                          : 'Select date range'}
                    </span>
                    <i className={`fas fa-chevron-${showDateRangeDropdown ? 'up' : 'down'}`}></i>
                  </button>
                  
                  {showDateRangeDropdown && availableDateRanges.length > 0 && (
                    <motion.div
                      className="date-range-dropdown"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                    >
                      {availableDateRanges.map(range => (
                        <div
                          key={range}
                          className={`date-range-option ${selectedDateRange === range ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedDateRange(range);
                            setShowDateRangeDropdown(false);
                          }}
                        >
                          <span className="range-text">{range.replace('_to_', ' to ')}</span>
                          {selectedDateRange === range && (
                            <i className="fas fa-check"></i>
                          )}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </div>
                
                {!selectedCity && selectedDateRange && dateRangeStats[selectedDateRange] && showDateRangeStats && (
                  <div className="date-range-stats">
                    <div className="stat-item stat-calculated">
                      <i className="fas fa-check-circle"></i>
                      <span>{dateRangeStats[selectedDateRange].calculated} Calculated</span>
                    </div>
                    <div className="stat-item stat-pending">
                      <i className="fas fa-clock"></i>
                      <span>{dateRangeStats[selectedDateRange].notCalculated} Pending</span>
                    </div>
                    <div className="stat-item stat-connectivity">
                      <i className="fas fa-signal"></i>
                      <span>{dateRangeStats[selectedDateRange].connectivityOnly} Connectivity Only</span>
                    </div>
                    <div className="stat-item stat-mobile">
                      <i className="fas fa-mobile-alt"></i>
                      <span>{dateRangeStats[selectedDateRange].mobilePingOnly} Mobile Ping Only</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {isLoading ? (
              <div className="loading-state">
                <i className="fas fa-spinner fa-spin"></i>
                <p>Loading indicator data...</p>
              </div>
            ) : selectedCity ? (
              <>
                <div className="section-header">
                  <h3>{selectedCity.name}</h3>
                </div>
                {renderIndicatorCards()}
              </>
            ) : (
              <>
                <div className="section-header">
                  <h3>All Cities Summary</h3>
                  <span className="result-count">{filteredAndSortedData.length} cities</span>
                </div>
                {renderSummaryTable()}
              </>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default IndicatorsSidebar;