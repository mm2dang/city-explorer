import React from 'react';
import '../styles/LoadingScreen.css';

const LoadingScreen = ({ message = "Loading CityExplorer" }) => {
  return (
    <div className="app-loading-overlay">
      <div className="loading-content">
        <div className="loading-logo">
          <i className="fas fa-map-marked-alt" style={{ marginRight: '0.5rem' }}></i>
          <span>CityExplorer</span>
        </div>
        
        <div className="loading-text">
          {message}
        </div>
        
        <div className="loading-spinner-container">
          <div className="loading-spinner">
            <div className="spinner-dot"></div>
            <div className="spinner-dot"></div>
            <div className="spinner-dot"></div>
          </div>
        </div>
        
        <div className="loading-features">
          <div className="feature-item">
            <i className="fas fa-city"></i>
            <span>Multi-City Analysis</span>
          </div>
          <div className="feature-item">
            <i className="fas fa-layer-group"></i>
            <span>Custom Layers</span>
          </div>
          <div className="feature-item">
            <i className="fas fa-chart-line"></i>
            <span>Urban Indicators</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;