import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const LayerToggle = ({ 
  layer, 
  domainColor, 
  isActive, 
  onToggle, 
  onEdit, 
  onDelete, 
  onExport, 
  isExporting,
  dropdownPositions,
  setDropdownPositions 
}) => {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  const formatLayerName = (name) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  const handleExportButtonClick = (e) => {
    e.stopPropagation();
    
    if (showExportMenu) {
      setShowExportMenu(false);
      setDropdownPositions({});
    } else {
      // Calculate position relative to scrollable container
      const button = e.currentTarget;
      const buttonRect = button.getBoundingClientRect();
      const container = button.closest('.layers-scroll-wrapper') || button.closest('.layers-container');
      const containerRect = container.getBoundingClientRect();
      
      const spaceBelow = containerRect.bottom - buttonRect.bottom;
      const spaceAbove = buttonRect.top - containerRect.top;
      
      // If less than 180px below, show above
      const showAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      
      setDropdownPositions({
        ...dropdownPositions,
        [`layer-${layer.name}`]: showAbove ? 'above' : 'below'
      });
      setShowExportMenu(true);
    }
  };

  const handleExportClick = (format) => {
    setShowExportMenu(false);
    onExport(format);
  };

  const handleDeleteClick = () => {
    onDelete();
  };

  return (
    <motion.div
      className={`layer-item-inline ${isActive ? 'active' : ''}`}
      whileHover={{ x: 2 }}
      style={{
        '--domain-color': domainColor
      }}
    >
      <div className="layer-main-inline" onClick={() => onToggle(!isActive)}>
        <motion.button
          className={`layer-checkbox ${isActive ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!isActive);
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {isActive && (
            <i className="fas fa-check" style={{ color: domainColor }}></i>
          )}
        </motion.button>
        
        <div className="layer-icon-inline">
          <i className={layer.icon} />
        </div>
        
        <span className="layer-name-inline">{formatLayerName(layer.name)}</span>
      </div>
      
      <div className="layer-actions-inline">
        <button
          className="inline-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit"
        >
          <i className="fas fa-edit"></i>
        </button>
        
        <div className="export-menu-inline" ref={exportMenuRef}>
          <button
            className="inline-action-btn export"
            onClick={handleExportButtonClick}
            title="Export"
            disabled={isExporting}
          >
            {isExporting ? (
              <i className="fas fa-spinner fa-spin"></i>
            ) : (
              <i className="fas fa-download"></i>
            )}
          </button>
          
          <AnimatePresence>
            {showExportMenu && (
              <motion.div
                className={`export-dropdown-inline ${
                  dropdownPositions[`layer-${layer.name}`] === 'below' ? 'dropdown-below' : ''
                }`}
                initial={{ opacity: 0, y: -5, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -5, scale: 0.95 }}
                transition={{ duration: 0.15 }}
              >
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportClick('parquet');
                  }}
                >
                  <i className="fas fa-database"></i>
                  <span>Parquet</span>
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportClick('csv');
                  }}
                >
                  <i className="fas fa-file-csv"></i>
                  <span>CSV</span>
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportClick('geojson');
                  }}
                >
                  <i className="fas fa-map-marked"></i>
                  <span>GeoJSON</span>
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportClick('shapefile');
                  }}
                >
                  <i className="fas fa-globe"></i>
                  <span>Shapefile</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <button
          className="inline-action-btn delete"
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteClick();
          }}
          title="Delete"
        >
          <i className="fas fa-trash"></i>
        </button>
      </div>
    </motion.div>
  );
};

export default LayerToggle;