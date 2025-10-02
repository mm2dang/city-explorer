import React, { useState } from 'react';
import { motion } from 'framer-motion';
import '../styles/Header.css';

const Header = ({ cities, selectedCity, onCitySelect, onAddCity, onEditCity, onDeleteCity, isLoading, cityDataStatus, processingProgress }) => {
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
    onCitySelect(city);
    setShowDropdown(false);
  };

  const getStatusCounts = () => {
    const ready = cities.filter(city => cityDataStatus[city.name]).length;
    const processing = Object.keys(processingProgress || {}).length;
    
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
                      const progress = processingProgress?.[city.name];
                      const isProcessing = progress && progress.status === 'processing';
                      
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
                              
                              {/* Population and Size row */}
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
                              
                              {/* Processing Status row */}
                              <div className="city-status-row">
                                <span className={`status-label ${isProcessing ? 'processing' : hasDataLayers ? 'ready' : 'pending'}`}>
                                  <i className={`fas fa-${isProcessing ? 'spinner fa-spin' : hasDataLayers ? 'check-circle' : 'clock'}`}></i>
                                  {isProcessing ? 'Processing' : hasDataLayers ? 'Ready' : 'Pending'}
                                </span>
                              </div>
                              
                              {/* Progress bar (only shown when processing) */}
                              {isProcessing && progress && (
                                <div className="processing-status">
                                  <div className="progress-bar">
                                    <div 
                                      className="progress-fill" 
                                      style={{ 
                                        width: `${Math.min((progress.processed / progress.total) * 100, 100)}%` 
                                      }}
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