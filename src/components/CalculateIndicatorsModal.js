import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { batchCheckCityCalculationStatus } from '../utils/indicators';
import '../styles/CalculateIndicatorsModal.css';

const CalculateIndicatorsModal = ({ cities, selectedCity, dataSource, onCancel, onCalculate, isLoading, processingProgress }) => {
  // Page state
  const [currentPage, setCurrentPage] = useState(1);

  // Default dates: June of last year to June of current year
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const lastYear = currentYear - 1;
  
  const [startMonth, setStartMonth] = useState(`${lastYear}-06`);
  const [endMonth, setEndMonth] = useState(`${currentYear}-06`);
  const [selectedCities, setSelectedCities] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const [calculateConnectivity, setCalculateConnectivity] = useState(true);
  const [calculateMobilePing, setCalculateMobilePing] = useState(true);

  const [cityStatusMap, setCityStatusMap] = useState(new Map());
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [sortBy, setSortBy] = useState('selected');
  const [sortOrder, setSortOrder] = useState('asc');
  const hasSetInitialCity = useRef(false);

  useEffect(() => {
    const modalContent = document.querySelector('.modal-content');
    if (modalContent) {
      modalContent.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  // Load calculation status
  useEffect(() => {
    const loadCalculationStatus = async () => {
      if (!startMonth || !endMonth || cities.length === 0) return;
      
      setLoadingStatus(true);
      try {
        const dateRange = `${startMonth}_to_${endMonth}`;
        const statusMap = await batchCheckCityCalculationStatus(cities, dateRange, dataSource);
        setCityStatusMap(statusMap);
        console.log('Loaded calculation status for all cities');
      } catch (error) {
        console.error('Error loading calculation status:', error);
      } finally {
        setLoadingStatus(false);
      }
    };

    if (currentPage === 2 && startMonth && endMonth) {
      loadCalculationStatus();
    }
  }, [currentPage, startMonth, endMonth, cities, dataSource]);

  const parseCityName = (cityName) => {
    const parts = cityName.split(',').map(part => part.trim());
    return {
      city: parts[0] || '',
      province: parts[1] || '',
      country: parts[2] || ''
    };
  };
  
  const handleSortChange = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // Filter and sort cities
  const filteredAndSortedCities = useMemo(() => {
    // First filter by cities with data and not processing
    let filtered = cities.filter(city => {
      // Check if city is currently processing
      const processingKey = `${city.name}@${dataSource}`;
      const progress = processingProgress?.[processingKey];
      const isProcessing = progress && progress.status === 'processing';
      if (isProcessing) return false;

      // If mobile ping is selected, check if city has data layers
      if (calculateMobilePing) {
        const hasData = city.hasDataLayers;
        if (!hasData) return false;
      }

      // Apply search filter
      if (!searchQuery.trim()) return true;
      
      const query = searchQuery.toLowerCase();
      const parsed = parseCityName(city.name);
      const cityName = parsed.city.toLowerCase();
      const province = parsed.province.toLowerCase();
      const country = parsed.country.toLowerCase();

      // Get calculation status for searching
      const status = cityStatusMap.get(city.name.toLowerCase()) || 'not_calculated';
      const statusLabels = {
        'calculated': 'calculated',
        'not_calculated': 'not calculated',
        'connectivity_only': 'connectivity only',
        'mobile_ping_only': 'mobile ping only'
      };
      const statusText = statusLabels[status] || '';

      return (
        cityName.includes(query) ||
        province.includes(query) ||
        country.includes(query) ||
        statusText.includes(query)
      );
    });

    // Add calculation status to each city
    const citiesWithStatus = filtered.map(city => {
      const status = cityStatusMap.get(city.name.toLowerCase()) || 'not_calculated';
      return {
        ...city,
        calculationStatus: status
      };
    });

    // Sort by selected field
    const sorted = [...citiesWithStatus].sort((a, b) => {
      let compareA, compareB;
      
      switch (sortBy) {
        case 'name':
          compareA = parseCityName(a.name).city.toLowerCase();
          compareB = parseCityName(b.name).city.toLowerCase();
          break;
        case 'province':
          compareA = parseCityName(a.name).province.toLowerCase();
          compareB = parseCityName(b.name).province.toLowerCase();
          break;
        case 'country':
          compareA = parseCityName(a.name).country.toLowerCase();
          compareB = parseCityName(b.name).country.toLowerCase();
          break;
        case 'status':
          const statusOrder = {
            'not_calculated': 0,
            'connectivity_only': 1,
            'mobile_ping_only': 2,
            'calculated': 3
          };
          compareA = statusOrder[a.calculationStatus] || 0;
          compareB = statusOrder[b.calculationStatus] || 0;
          break;
        case 'selected':
          compareA = selectedCities.has(a.name) ? 0 : 1;
          compareB = selectedCities.has(b.name) ? 0 : 1;
          break;
        default:
          compareA = a.name.toLowerCase();
          compareB = b.name.toLowerCase();
      }
      
      // Primary sort
      let primaryCompare = 0;
      if (compareA < compareB) primaryCompare = sortOrder === 'asc' ? -1 : 1;
      else if (compareA > compareB) primaryCompare = sortOrder === 'asc' ? 1 : -1;
      
      // If primary sort values are equal, secondary sort by city name
      if (primaryCompare === 0) {
        const nameA = parseCityName(a.name).city.toLowerCase();
        const nameB = parseCityName(b.name).city.toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      }
      
      return primaryCompare;
    });

    return sorted;
  }, [cities, searchQuery, selectedCities, dataSource, processingProgress, cityStatusMap, sortBy, sortOrder, calculateMobilePing]);

  // Set initial selected city only if it passes filters
  useEffect(() => {
    if (selectedCity && currentPage === 2 && !hasSetInitialCity.current) {
      const cityExists = filteredAndSortedCities.some(city => city.name === selectedCity.name);
      if (cityExists) {
        setSelectedCities(new Set([selectedCity.name]));
      }
      hasSetInitialCity.current = true;
    }
  }, [currentPage, filteredAndSortedCities, selectedCity]);
  
  const toggleCity = (cityName) => {
    const newSelected = new Set(selectedCities);
    if (newSelected.has(cityName)) {
      newSelected.delete(cityName);
    } else {
      newSelected.add(cityName);
    }
    setSelectedCities(newSelected);
  };

  const toggleAll = (isSelected) => {
    if (isSelected) {
      setSelectedCities(new Set(filteredAndSortedCities.map(c => c.name)));
    } else {
      setSelectedCities(new Set());
    }
  };

  const handleNextPage = () => {
    if (!startMonth || !endMonth) {
      alert('Please select start and end months');
      return;
    }

    // Parse dates to validate
    const [startYear, startMon] = startMonth.split('-').map(Number);
    const [endYear, endMon] = endMonth.split('-').map(Number);
    
    const startDate = new Date(startYear, startMon - 1);
    const endDate = new Date(endYear, endMon - 1);
    
    if (startDate > endDate) {
      alert('Start month must be before end month');
      return;
    }

    setCurrentPage(2);
  };

  const handleCalculate = () => {
    if (selectedCities.size === 0) {
      alert('Please select at least one city');
      return;
    }
  
    if (!calculateMobilePing && !calculateConnectivity) {
      alert('Please select at least one calculation type');
      return;
    }
  
    const cityList = [];
    const provinceList = [];
    const countryList = [];
    
    for (const cityName of selectedCities) {
      const parts = cityName.split(',').map(p => p.trim());
      let city, province, country;
      
      if (parts.length === 2) {
        [city, country] = parts;
        province = '';
      } else if (parts.length === 3) {
        [city, province, country] = parts;
      } else {
        console.warn(`Unexpected city format: ${cityName}`);
        continue;
      }
      
      cityList.push(city);
      provinceList.push(province || '');
      countryList.push(country);
    }
  
    const calculationParams = {
      cities: {
        CITY: cityList.join(','),
        PROVINCE: provinceList.join(','),
        COUNTRY: countryList.join(',')
      },
      dateRange: {
        START_MONTH: startMonth,
        END_MONTH: endMonth
      },
      dataSource: dataSource,
      calculateConnectivity: calculateConnectivity,
      calculateMobilePing: calculateMobilePing
    };
  
    console.log('Starting calculation with parameters:', calculationParams);
    
    onCalculate(calculationParams);
  };

  const allSelected = selectedCities.size === filteredAndSortedCities.length && filteredAndSortedCities.length > 0;

  const renderStatusBadge = (status) => {
    const statusConfig = {
      'calculated': {
        icon: 'fa-check-circle',
        label: 'Calculated',
        className: 'status-calculated'
      },
      'not_calculated': {
        icon: 'fa-times-circle',
        label: 'Not Calculated',
        className: 'status-not-calculated'
      },
      'connectivity_only': {
        icon: 'fa-signal',
        label: 'Connectivity Only',
        className: 'status-connectivity-only'
      },
      'mobile_ping_only': {
        icon: 'fa-mobile-alt',
        label: 'Mobile Ping Only',
        className: 'status-mobile-ping-only'
      }
    };

    const config = statusConfig[status] || statusConfig['not_calculated'];

    return (
      <span className={`calculation-status-badge ${config.className}`}>
        <i className={`fas ${config.icon}`}></i>
        {config.label}
      </span>
    );
  };

  return (
    <div className="modal-overlay-indicators" onClick={(e) => {
      if (e.target.className === 'modal-overlay-indicators') onCancel();
    }}>
      <motion.div
        className="modal-container calculate-indicators-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Calculate Indicators</h2>
          <button className="close-btn" onClick={onCancel}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="modal-steps">
          <div className={`step ${currentPage >= 1 ? 'active' : ''}`}>
            1. Date & Source
          </div>
          <div className={`step ${currentPage >= 2 ? 'active' : ''}`}>
            2. Select Cities
          </div>
        </div>

        <div className="modal-content">
          {currentPage === 1 && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Date Range Selection */}
              <div className="section">
                <h3>Date Range</h3>
                <div className="date-range-group">
                  <div className="form-group">
                    <label>Start Month</label>
                    <input
                      type="month"
                      value={startMonth}
                      onChange={(e) => setStartMonth(e.target.value)}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>End Month</label>
                    <input
                      type="month"
                      value={endMonth}
                      onChange={(e) => setEndMonth(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={calculateMobilePing}
                    onChange={(e) => setCalculateMobilePing(e.target.checked)}
                  />
                  <span className="checkbox-label">
                    Calculate mobile ping metrics (out at night, leisure dwell time, cultural visits)
                  </span>
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={calculateConnectivity}
                    onChange={(e) => setCalculateConnectivity(e.target.checked)}
                  />
                  <span className="checkbox-label">
                    Calculate connectivity metrics (speed, latency, coverage)
                  </span>
                </label>
              </div>
            </motion.div>
          )}

          {currentPage === 2 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* City Selection */}
              <div className="section">
                <div className="calculate-section-header">
                  <h3>Select Cities</h3>
                  <span className="city-count">
                    {selectedCities.size} of {filteredAndSortedCities.length} selected
                  </span>
                </div>

                {/* Search Box */}
                <div className="search-container">
                  <i className="fas fa-search search-icon"></i>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search by city, province, country, or status..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      className="clear-search-btn"
                      onClick={() => setSearchQuery('')}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  )}
                </div>

                {/* Sort Controls */}
                <div className="modal-sort-controls">
                  <span className="modal-sort-label">Sort by:</span>
                  <button
                    className={`modal-sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                    onClick={() => handleSortChange('name')}
                  >
                    City {sortBy === 'name' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                  </button>
                  <button
                    className={`modal-sort-btn ${sortBy === 'province' ? 'active' : ''}`}
                    onClick={() => handleSortChange('province')}
                  >
                    Province {sortBy === 'province' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                  </button>
                  <button
                    className={`modal-sort-btn ${sortBy === 'country' ? 'active' : ''}`}
                    onClick={() => handleSortChange('country')}
                  >
                    Country {sortBy === 'country' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                  </button>
                  <button
                    className={`modal-sort-btn ${sortBy === 'status' ? 'active' : ''}`}
                    onClick={() => handleSortChange('status')}
                  >
                    Status {sortBy === 'status' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                  </button>
                  <button
                    className={`modal-sort-btn ${sortBy === 'selected' ? 'active' : ''}`}
                    onClick={() => handleSortChange('selected')}
                  >
                    Selected {sortBy === 'selected' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                  </button>
                </div>

                {/* Select All / Deselect All */}
                <div className="select-all-container">
                  <label className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                    <span className="checkbox-label">
                      {allSelected ? 'Deselect All' : 'Select All'}
                    </span>
                  </label>
                </div>

                {/* Cities List */}
                <div className="cities-list">
                  {loadingStatus ? (
                    <div className="loading-status-message">
                      <i className="fas fa-spinner fa-spin"></i>
                      <p>Checking calculation status...</p>
                    </div>
                  ) : filteredAndSortedCities.length === 0 ? (
                    <div className="no-cities-message">
                      {searchQuery ? (
                        <>
                          <i className="fas fa-search"></i>
                          <p>No cities found matching "{searchQuery}"</p>
                        </>
                      ) : (
                        <>
                          <i className="fas fa-inbox"></i>
                          <p>No cities available with complete data</p>
                          <small>Cities must have data layers and not be processing</small>
                        </>
                      )}
                    </div>
                  ) : (
                    filteredAndSortedCities.map((city) => (
                      <label key={city.name} className="checkbox-option city-item">
                        <input
                          type="checkbox"
                          checked={selectedCities.has(city.name)}
                          onChange={() => toggleCity(city.name)}
                        />
                        <span className="checkbox-label city-item-content">
                          <span className="city-name">{city.name}</span>
                          {renderStatusBadge(city.calculationStatus)}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        <div className="modal-footer">
          {currentPage === 2 && (
            <motion.button
              className="btn btn-secondary"
              onClick={() => setCurrentPage(1)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <i className="fas fa-arrow-left"></i>
              Previous
            </motion.button>
          )}
          <div className="footer-spacer"></div>
          {currentPage === 1 ? (
            <motion.button
              className="btn btn-primary"
              onClick={handleNextPage}
              disabled={!calculateMobilePing && !calculateConnectivity}
              whileHover={{ scale: (!calculateMobilePing && !calculateConnectivity) ? 1 : 1.02 }}
              whileTap={{ scale: (!calculateMobilePing && !calculateConnectivity) ? 1 : 0.98 }}
            >
              Next
              <i className="fas fa-arrow-right"></i>
            </motion.button>
          ) : (
            <motion.button
              className="btn btn-success"
              onClick={handleCalculate}
              disabled={isLoading || selectedCities.size === 0}
              whileHover={{ scale: isLoading || selectedCities.size === 0 ? 1 : 1.02 }}
              whileTap={{ scale: isLoading || selectedCities.size === 0 ? 1 : 0.98 }}
            >
              {isLoading ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Calculating...
                </>
              ) : (
                <>
                  <i className="fas fa-calculator"></i>
                  Calculate
                </>
              )}
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default CalculateIndicatorsModal;