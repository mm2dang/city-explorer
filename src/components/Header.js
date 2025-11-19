import React, { useState } from 'react';
import { motion } from 'framer-motion';
import '../styles/Header.css';

const Header = ({
  cities = [],
  selectedCity = null,
  onCitySelect = () => {},
  onAddCity = () => {},
  onEditCity = () => {},
  onDeleteCity = () => {},
  isLoading = false,
  cityDataStatus = {},
  processingProgress = {},
  dataSource = 'osm',
  onDataSourceChange = () => {},
  mapView = 'street',
  onMapViewChange = () => {}
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [searchQuery, setSearchQuery] = useState('');

  const handleCityAction = (e, action, city) => {
    e.stopPropagation();
    if (action === 'edit') {
      onEditCity(city);
    } else if (action === 'delete') {
      onDeleteCity(city.name);
    }
    setShowDropdown(false);
  };

  const handleCitySelect = (city) => {
    // Handle null case for deselecting
    if (city === null) {
      onCitySelect(null);
      setShowDropdown(false);
      setSearchQuery('');
      return;
    }
  
    // Create processing key for current data source
    const processingKey = `${city.name}@${dataSource}`;
    const progress = processingProgress?.[processingKey];
    
    // Only block if processing in CURRENT data source
    const isProcessing = progress && 
                        progress.status === 'processing' && 
                        progress.dataSource === dataSource;
    
    // Block selection if the city is processing in the CURRENT data source
    if (isProcessing) {
      console.log('Cannot select city - currently processing in', dataSource, 'data source:', city.name);
      return;
    }
    
    onCitySelect(city);
    setShowDropdown(false);
    setSearchQuery('');
  };

  const handleCityDropdownToggle = () => {
    setShowDropdown(!showDropdown);
    setShowSettings(false); // Close settings when opening city selector
    if (!showDropdown) {
      setSearchQuery(''); // Clear search when opening dropdown
    }
  };

  const handleSettingsToggle = () => {
    setShowSettings(!showSettings);
    setShowDropdown(false); // Close city selector when opening settings
  };

  const handleDataSourceChange = async (source) => {
    await onDataSourceChange(source);
  };

  const handleMapViewChange = (view) => {
    setShowSettings(false);
    onMapViewChange(view);
  };

  const handleHomeClick = () => {
    onCitySelect(null);
    setShowDropdown(false);
    setSearchQuery('');
  };

  const handleSortChange = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const parseCityName = (cityName) => {
    // Parse "City, Province, Country" format
    const parts = cityName.split(',').map(part => part.trim());
    return {
      city: parts[0] || '',
      province: parts[1] || '',
      country: parts[2] || ''
    };
  };

  const filterCities = (citiesToFilter) => {
    if (!searchQuery.trim()) return citiesToFilter;

    const query = searchQuery.toLowerCase().trim();
    
    return citiesToFilter.filter(city => {
      const parsed = parseCityName(city.name);
      const cityName = parsed.city.toLowerCase();
      const province = parsed.province.toLowerCase();
      const country = parsed.country.toLowerCase();
      const population = city.population ? city.population.toString() : '';
      const size = city.size ? city.size.toString() : '';

      // Determine status for search
      const hasDataLayers = cityDataStatus ? cityDataStatus[city.name] : false;
      const processingKey = `${city.name}@${dataSource}`;
      const progress = processingProgress?.[processingKey];
      const isProcessing = progress && 
                          progress.status === 'processing' && 
                          progress.dataSource === dataSource;
      
      let status = 'pending';
      if (isProcessing) {
        status = 'processing';
      } else if (hasDataLayers) {
        status = 'ready';
      }

      return (
        cityName.includes(query) ||
        province.includes(query) ||
        country.includes(query) ||
        population.includes(query) ||
        size.includes(query) ||
        status.includes(query)
      );
    });
  };

  const sortCities = (citiesToSort) => {
    return [...citiesToSort].sort((a, b) => {
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
        case 'population':
          compareA = a.population || 0;
          compareB = b.population || 0;
          break;
        case 'size':
          compareA = a.size || 0;
          compareB = b.size || 0;
          break;
        case 'status':
          // Determine status for each city
          const getStatusOrder = (city) => {
            const hasDataLayers = cityDataStatus ? cityDataStatus[city.name] : false;
            const processingKey = `${city.name}@${dataSource}`;
            const progress = processingProgress?.[processingKey];
            const isProcessing = progress && 
                                progress.status === 'processing' && 
                                progress.dataSource === dataSource;
            
            if (isProcessing) return 1; // processing
            if (hasDataLayers) return 0; // ready
            return 2; // pending
          };
          
          compareA = getStatusOrder(a);
          compareB = getStatusOrder(b);
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
  };

  const filteredCities = filterCities(cities);
  const sortedCities = sortCities(filteredCities);

  return (
    <header className="header">
      <div className="header-main-content">
        <motion.div 
          className="app-title" 
          onClick={handleHomeClick}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          style={{ cursor: 'pointer' }}
          title="Return to home"
        >
          <div className="title-row">
            <i className="fas fa-map-marked-alt"></i>
            <h1>CityExplorer</h1>
          </div>
        </motion.div>

        <div className="header-controls">
          <div className="city-selector">
          <motion.button
            className="city-selector-btn"
            onClick={handleCityDropdownToggle}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span>
              {selectedCity ? (
                // Display fresh city data from the cities array
                (() => {
                  const freshCity = cities.find(c => c.name === selectedCity.name);
                  return freshCity ? freshCity.name : selectedCity.name;
                })()
              ) : 'Select a city'}
            </span>
            <i className={`fas fa-chevron-${showDropdown ? 'up' : 'down'}`}></i>
          </motion.button>

            {showDropdown && (
              <motion.div
                className="city-dropdown"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {isLoading ? (
                  <div className="dropdown-item loading">
                    <i className="fas fa-spinner fa-spin"></i>
                    Loading cities from S3...
                  </div>
                ) : cities.length === 0 ? (
                  <div className="dropdown-item empty">
                    <i className="fas fa-info-circle"></i>
                    <div>
                      <strong>No cities found</strong>
                      <p>Add a city to get started</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="dropdown-header">
                      <span>Available Cities ({cities.length})</span>
                    </div>

                    {/* Search Input */}
                    <div className="search-container">
                      <i className="fas fa-search search-icon"></i>
                      <input
                        type="text"
                        className="search-input"
                        placeholder="Search any field..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {searchQuery && (
                        <button
                          className="clear-search-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSearchQuery('');
                          }}
                          title="Clear search"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      )}
                    </div>

                    {/* Results count when searching */}
                    {searchQuery && (
                      <div className="search-results-info">
                        <span>{filteredCities.length} result{filteredCities.length !== 1 ? 's' : ''} found</span>
                      </div>
                    )}

                    <div className="sort-controls">
                      <span className="sort-label">Sort by:</span>
                      <button
                        className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                        onClick={() => handleSortChange('name')}
                      >
                        City {sortBy === 'name' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                      </button>
                      <button
                        className={`sort-btn ${sortBy === 'province' ? 'active' : ''}`}
                        onClick={() => handleSortChange('province')}
                      >
                        Province {sortBy === 'province' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                      </button>
                      <button
                        className={`sort-btn ${sortBy === 'country' ? 'active' : ''}`}
                        onClick={() => handleSortChange('country')}
                      >
                        Country {sortBy === 'country' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                      </button>
                      <button
                        className={`sort-btn ${sortBy === 'population' ? 'active' : ''}`}
                        onClick={() => handleSortChange('population')}
                      >
                        Population {sortBy === 'population' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                      </button>
                      <button
                        className={`sort-btn ${sortBy === 'size' ? 'active' : ''}`}
                        onClick={() => handleSortChange('size')}
                      >
                        Size {sortBy === 'size' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                      </button>
                      <button
                        className={`sort-btn ${sortBy === 'status' ? 'active' : ''}`}
                        onClick={() => handleSortChange('status')}
                      >
                        Status {sortBy === 'status' && <i className={`fas fa-chevron-${sortOrder === 'asc' ? 'up' : 'down'}`}></i>}
                      </button>
                    </div>

                    {sortedCities.length === 0 ? (
                      <div className="dropdown-item empty">
                        <i className="fas fa-search"></i>
                        <div>
                          <strong>No cities match your search</strong>
                          <p>Try different search terms</p>
                        </div>
                      </div>
                    ) : (
                      sortedCities.map((city) => {
                        const hasDataLayers = cityDataStatus ? cityDataStatus[city.name] : false;
                        const processingKey = `${city.name}@${dataSource}`;
                        const progress = processingProgress?.[processingKey];
                        
                        // A city is processing if it has progress data with status 'processing' for current data source
                        const isProcessing = progress && 
                                            progress.status === 'processing' && 
                                            progress.dataSource === dataSource;
                        
                        // Determine display status: processing takes ABSOLUTE priority
                        let displayStatus = 'pending';
                        let statusIcon = 'clock';
                        
                        if (isProcessing) {
                          // While processing, always show processing regardless of hasDataLayers
                          displayStatus = 'processing';
                          statusIcon = 'spinner fa-spin';
                        } else if (hasDataLayers) {
                          // Only show ready when NOT processing and has data
                          displayStatus = 'ready';
                          statusIcon = 'check-circle';
                        }
                      
                        return (
                          <div key={city.name} className="dropdown-item-container">
                            <motion.div
                              className={`dropdown-item ${selectedCity?.name === city.name ? 'selected' : ''} ${isProcessing ? 'disabled' : ''}`}
                              onClick={() => handleCitySelect(city)}
                              whileHover={!isProcessing ? { backgroundColor: '#f0f9ff' } : {}}
                              style={{ cursor: !isProcessing ? 'pointer' : 'not-allowed', opacity: !isProcessing ? 1 : 0.6 }}
                            >
                              <div className="city-info">
                                <div className="city-header">
                                  <span className="city-name">{city.name}</span>
                                  <div className="city-actions">
                                    <button
                                      className="action-btn edit-btn"
                                      onClick={(e) => handleCityAction(e, 'edit', city)}
                                      title="Edit city"
                                    >
                                      <i className="fas fa-edit"></i>
                                    </button>
                                    <button
                                      className="action-btn delete-btn"
                                      onClick={(e) => handleCityAction(e, 'delete', city)}
                                      title="Delete city"
                                    >
                                      <i className="fas fa-trash"></i>
                                    </button>
                                  </div>
                                </div>
                      
                                {(city.population || city.size) && (
                                  <div className="city-meta-row">
                                    {city.population && (
                                      <span className="city-details">
                                        <i className="fas fa-users"></i>
                                        {city.population.toLocaleString()}
                                      </span>
                                    )}
                                    {city.size && (
                                      <span className="city-details">
                                        <i className="fas fa-expand-arrows-alt"></i>
                                        {city.size} km²
                                      </span>
                                    )}
                                  </div>
                                )}
                      
                                <div className="city-status-row">
                                  <span className={`status-label ${displayStatus}`}>
                                    <i className={`fas fa-${statusIcon}`}></i>
                                    {displayStatus === 'processing' ? 'Processing' : displayStatus === 'ready' ? 'Ready' : 'Pending'}
                                  </span>
                                </div>
                      
                                {isProcessing && progress && (
                                  <div className="processing-status">
                                    <div className="progress-bar">
                                      <div
                                        className="progress-fill"
                                        style={{ width: `${Math.min((progress.processed / progress.total) * 100, 100)}%` }}
                                      />
                                    </div>
                                    <small className="progress-text">
                                      {progress.processed} / {progress.total} layers processed
                                      {progress.saved !== undefined && progress.saved !== progress.processed &&
                                        ` (${progress.saved} with data)`
                                      }
                                    </small>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </motion.div>
            )}
          </div>

          <motion.button
            className="add-city-btn"
            onClick={onAddCity}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Add a new city to the system"
          >
            <i className="fas fa-plus"></i>
            Add City
          </motion.button>

          <div className="settings-selector">
            <motion.button
              className="settings-btn"
              onClick={handleSettingsToggle}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Data source settings"
            >
              <i className="fas fa-cog"></i>
            </motion.button>

            {showSettings && (
              <motion.div
                className="settings-dropdown"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="settings-header">
                  <i className="fas fa-database"></i>
                  <span>Data Source</span>
                </div>
                <div className="settings-options">
                  <button
                    className={`settings-option ${dataSource === 'osm' ? 'active' : ''}`}
                    onClick={() => handleDataSourceChange('osm')}
                  >
                    <div className="option-content">
                      <i className="fas fa-map"></i>
                      <div className="option-text">
                        <strong>OpenStreetMap Data</strong>
                        <small>Community-sourced geographic data</small>
                      </div>
                    </div>
                    {dataSource === 'osm' && <i className="fas fa-check-circle"></i>}
                  </button>

                  <button
                    className={`settings-option ${dataSource === 'city' ? 'active' : ''}`}
                    onClick={() => handleDataSourceChange('city')}
                  >
                    <div className="option-content">
                      <i className="fas fa-upload"></i>
                      <div className="option-text">
                        <strong>Uploaded Data</strong>
                        <small>Custom uploaded geographic data</small>
                      </div>
                    </div>
                    {dataSource === 'city' && <i className="fas fa-check-circle"></i>}
                  </button>
                </div>

                <div className="settings-header">
                  <i className="fas fa-map-marked-alt"></i>
                  <span>Map View</span>
                </div>
                <div className="settings-options">
                  <button
                    className={`settings-option ${mapView === 'street' ? 'active' : ''}`}
                    onClick={() => handleMapViewChange('street')}
                  >
                    <div className="option-content">
                      <i className="fas fa-road"></i>
                      <div className="option-text">
                        <strong>Street View</strong>
                        <small>Standard street map with labels</small>
                      </div>
                    </div>
                    {mapView === 'street' && <i className="fas fa-check-circle"></i>}
                  </button>

                  <button
                    className={`settings-option ${mapView === 'satellite' ? 'active' : ''}`}
                    onClick={() => handleMapViewChange('satellite')}
                  >
                    <div className="option-content">
                      <i className="fas fa-satellite"></i>
                      <div className="option-text">
                        <strong>Satellite View</strong>
                        <small>Aerial imagery from space</small>
                      </div>
                    </div>
                    {mapView === 'satellite' && <i className="fas fa-check-circle"></i>}
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;