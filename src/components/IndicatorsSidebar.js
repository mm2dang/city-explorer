import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  getAvailableDateRanges,
  getSummaryData,
  getGlueJobStatus
} from '../utils/indicators';
import Papa from 'papaparse';
import '../styles/IndicatorsSidebar.css';

const IndicatorsSidebar = ({ selectedCity, dataSource, onCalculateIndicators }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
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

  // Indicator definitions with labels and descriptions
  const indicators = useMemo(() => ({
    out_at_night: {
      label: 'Out at Night',
      description: 'Proportion of people seen after dark (8 PM - 4 AM)',
      color: '#8b5cf6',
      unit: '%',
      icon: 'fa-moon'
    },
    leisure_dwell_time: {
      label: 'Leisure Dwell Time',
      description: 'Average dwell time in cultural or recreational sites',
      color: '#10b981',
      unit: 'min',
      icon: 'fa-clock'
    },
    cultural_visits: {
      label: 'Cultural Visits',
      description: 'Average number of visits to cultural or recreational sites per month',
      color: '#f59e0b',
      unit: 'visits',
      icon: 'fa-palette'
    },
    coverage: {
      label: 'Coverage',
      description: 'Proportion of people with mobile internet access',
      color: '#3b82f6',
      unit: '%',
      icon: 'fa-signal'
    },
    speed: {
      label: 'Speed',
      description: 'Mobile internet download speed',
      color: '#ef4444',
      unit: 'kbps',
      icon: 'fa-tachometer-alt'
    },
    latency: {
      label: 'Latency',
      description: 'Mobile internet download latency',
      color: '#ec4899',
      unit: 'ms',
      icon: 'fa-stopwatch'
    }
  }), []);

  // Load available date ranges
  const loadDateRanges = useCallback(async () => {
    try {
      const ranges = await getAvailableDateRanges(dataSource);
      setAvailableDateRanges(ranges);
      if (ranges.length > 0 && !selectedDateRange) {
        setSelectedDateRange(ranges[0]); // Select most recent by default
      }
    } catch (error) {
      console.error('Error loading date ranges:', error);
    }
  }, [dataSource, selectedDateRange]);

  // Load summary data
  const loadSummaryData = useCallback(async () => {
    if (!selectedDateRange) return;
    setIsLoading(true);
    try {
      const data = await getSummaryData(dataSource, selectedDateRange);
      setSummaryData(data);
    } catch (error) {
      console.error('Error loading summary data:', error);
      setSummaryData([]);
    } finally {
      setIsLoading(false);
    }
  }, [dataSource, selectedDateRange]);

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
  const canExport = summaryData.length > 0;

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
    return (
      <div className="collapsed-indicators-view">
        {Object.entries(indicators).map(([key, info]) => {
          const value = selectedCityData[key];
          const hasValue = value != null && !isNaN(value);
          return (
            <motion.div
              key={key}
              className="collapsed-indicator-item"
              title={`${info.label}: ${hasValue ? Number(value).toFixed(2) : '-'} ${info.unit}`}
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
                {hasValue ? Number(value).toFixed(1) : '-'}
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
    return (
      <div className="indicator-cards-container">
        {Object.entries(indicators).map(([key, info], index) => {
          const value = selectedCityData[key];
          const hasValue = value != null && !isNaN(value);
          return (
            <motion.div
              key={key}
              className="indicator-card"
              style={{ '--card-color': info.color }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              whileHover={{ scale: 1.02 }}
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
              </div>
              <div className="indicator-card-value">
                <span className="value" style={{ color: info.color }}>
                  {hasValue ? Number(value).toFixed(2) : '-'}
                </span>
                <span className="unit">{info.unit}</span>
              </div>
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
                {['city', 'province', 'country', ...Object.keys(indicators)].map(key => (
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
                  {Object.keys(indicators).map(indicator => (
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
          onClick={() => setIsCollapsed(!isCollapsed)}
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
            <div className="no-data-icon">
              <i className="fas fa-map-pin"></i>
            </div>
          </div>
        )
      ) : (
        <div className="indicators-content">
          <div className="controls-section">
            <div className="controls-buttons">
              <button
                className="calculate-btn"
                onClick={onCalculateIndicators}
                disabled={isCalculating}
              >
                <i className={`fas ${isCalculating ? 'fa-spinner fa-spin' : 'fa-calculator'}`}></i>
                {isCalculating ? 'Calculating...' : 'Calculate Indicators'}
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
            {isCalculating && calculationStatus && (
              <div className="calculation-status">
                <div className="status-bar">
                  <div
                    className="status-fill"
                    style={{ width: `${calculationStatus.progress || 0}%` }}
                  />
                </div>
                <small>{calculationStatus.state}: {calculationStatus.message || 'Processing...'}</small>
              </div>
            )}
            <div className="date-range-selector">
              <label>Date Range:</label>
              <select
                value={selectedDateRange || ''}
                onChange={(e) => setSelectedDateRange(e.target.value)}
                disabled={isLoading || availableDateRanges.length === 0}
              >
                {availableDateRanges.length === 0 ? (
                  <option value="">No date ranges available</option>
                ) : (
                  availableDateRanges.map(range => (
                    <option key={range} value={range}>
                      {range.replace('_to_', ' to ')}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <div className="indicators-scroll-content">
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