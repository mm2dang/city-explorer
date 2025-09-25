import React, { useState } from 'react';
import { motion } from 'framer-motion';
import '../styles/Header.css';

const Header = ({ cities, selectedCity, onCitySelect, onAddCity, onEditCity, onDeleteCity, isLoading, cityDataStatus }) => {
  const [showDropdown, setShowDropdown] = useState(false);

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
    // Allow selection of all cities - remove the restriction
    onCitySelect(city);
    setShowDropdown(false);
    
    // Show info message if city doesn't have data layers yet
    const hasDataLayers = cityDataStatus[city.name];
    if (!hasDataLayers) {
      // Use setTimeout to show message after selection
      setTimeout(() => {
        alert(`${city.name} is selected but data layers may still be processing. Some layers might not be available yet.`);
      }, 500);
    }
  };

  const getStatusCounts = () => {
    const ready = cities.filter(city => cityDataStatus[city.name]).length;
    const processing = cities.length - ready;
    
    return { ready, processing, total: cities.length };
  };

  const statusCounts = getStatusCounts();

  return (
    <header className="header">
      <div className="header-content">
        <div className="app-title">
          <i className="fas fa-map-marked-alt"></i>
          <h1>CityExplorer</h1>
          <div className="status-summary">
            <small>
              {cities.length} cities available
              {statusCounts.ready > 0 && ` • ${statusCounts.ready} ready`}
              {statusCounts.processing > 0 && ` • ${statusCounts.processing} processing`}
            </small>
          </div>
        </div>
        
        <div className="header-controls">
          <div className="city-selector">
            <motion.button
              className="city-selector-btn"
              onClick={() => setShowDropdown(!showDropdown)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span>
                {selectedCity ? selectedCity.name : 'Select a city'}
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
                    {cities.map((city) => {
                      const hasDataLayers = cityDataStatus[city.name];
                      
                      return (
                        <div key={city.name} className="dropdown-item-container">
                          <motion.div
                            className={`dropdown-item ${selectedCity?.name === city.name ? 'selected' : ''}`}
                            onClick={() => handleCitySelect(city)}
                            whileHover={{ backgroundColor: '#f0f9ff' }}
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
                              
                              <div className="city-meta">
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
                                <span className={`status-label ${hasDataLayers ? 'ready' : 'processing'}`}>
                                  <i className={`fas fa-${hasDataLayers ? 'check-circle' : 'clock'}`}></i>
                                  {hasDataLayers ? 'Ready' : 'Processing'}
                                </span>
                              </div>
                              
                              {!hasDataLayers && (
                                <div className="selection-hint">
                                  <small>
                                    <i className="fas fa-info-circle"></i>
                                    Data layers may still be processing in the background
                                  </small>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        </div>
                      );
                    })}
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
        </div>
      </div>
    </header>
  );
};

export default Header;