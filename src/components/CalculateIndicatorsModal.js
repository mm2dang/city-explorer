import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import '../styles/CalculateIndicatorsModal.css';

const CalculateIndicatorsModal = ({ cities, selectedCity, dataSource, onCancel, onCalculate, isLoading }) => {
  // Page state
  const [currentPage, setCurrentPage] = useState(1);

  // Default dates: June of last year to June of current year
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const lastYear = currentYear - 1;
  
  const [startMonth, setStartMonth] = useState(`${lastYear}-06`);
  const [endMonth, setEndMonth] = useState(`${currentYear}-06`);
  const [selectedCities, setSelectedCities] = useState(
    selectedCity ? new Set([selectedCity.name]) : new Set()
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('city');
  const [sortOrder, setSortOrder] = useState('asc');

  const [calculateConnectivity, setCalculateConnectivity] = useState(true);
  const [calculateMobilePing, setCalculateMobilePing] = useState(true);

  // Filter and sort cities
  const filteredAndSortedCities = useMemo(() => {
    // First filter by search query
    let filtered = cities.filter(city => {
      if (!searchQuery.trim()) return true;
      
      const query = searchQuery.toLowerCase();
      const parts = city.name.split(',').map(p => p.trim());
      
      return parts.some(part => part.toLowerCase().includes(query));
    });

    // Sort the filtered cities
    const sorted = [...filtered].sort((a, b) => {
      const aParts = a.name.split(',').map(p => p.trim());
      const bParts = b.name.split(',').map(p => p.trim());
      
      let aValue, bValue;
      
      if (sortBy === 'city') {
        aValue = aParts[0].toLowerCase();
        bValue = bParts[0].toLowerCase();
      } else if (sortBy === 'province') {
        // Province is second to last part (or empty if only city and country)
        aValue = (aParts.length >= 3 ? aParts[aParts.length - 2] : '').toLowerCase();
        bValue = (bParts.length >= 3 ? bParts[bParts.length - 2] : '').toLowerCase();
      } else if (sortBy === 'country') {
        aValue = aParts[aParts.length - 1].toLowerCase();
        bValue = bParts[bParts.length - 1].toLowerCase();
      }
      
      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // Separate selected and unselected
    const selected = sorted.filter(city => selectedCities.has(city.name));
    const unselected = sorted.filter(city => !selectedCities.has(city.name));

    return [...selected, ...unselected];
  }, [cities, searchQuery, sortBy, sortOrder, selectedCities]);

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
                <div className="section-header">
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
                    placeholder="Search by city, province, or country..."
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
                <div className="sort-controls">
                <span className="sort-label">Sort by:</span>
                <button
                    className={`sort-btn ${sortBy === 'city' ? 'active' : ''}`}
                    onClick={() => {
                    if (sortBy === 'city') {
                        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                    } else {
                        setSortBy('city');
                        setSortOrder('asc');
                    }
                    }}
                >
                    City {sortBy === 'city' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                </button>
                <button
                    className={`sort-btn ${sortBy === 'province' ? 'active' : ''}`}
                    onClick={() => {
                    if (sortBy === 'province') {
                        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                    } else {
                        setSortBy('province');
                        setSortOrder('asc');
                    }
                    }}
                >
                    Province {sortBy === 'province' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                </button>
                <button
                    className={`sort-btn ${sortBy === 'country' ? 'active' : ''}`}
                    onClick={() => {
                    if (sortBy === 'country') {
                        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                    } else {
                        setSortBy('country');
                        setSortOrder('asc');
                    }
                    }}
                >
                    Country {sortBy === 'country' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
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
                  {filteredAndSortedCities.length === 0 ? (
                    <div className="no-cities-message">
                      {searchQuery ? (
                        <>
                          <i className="fas fa-search"></i>
                          <p>No cities found matching "{searchQuery}"</p>
                        </>
                      ) : (
                        <>
                          <i className="fas fa-inbox"></i>
                          <p>No cities available</p>
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
                        <span className="checkbox-label">
                          <span className="city-name">{city.name}</span>
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
          <motion.button
            className="btn btn-secondary"
            onClick={onCancel}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Cancel
          </motion.button>
          {currentPage === 1 ? (
            <motion.button
              className="btn btn-primary"
              onClick={handleNextPage}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
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
                  Calculate Indicators
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