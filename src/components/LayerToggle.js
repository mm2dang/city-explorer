import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const LayerToggle = ({ layer, domainColor, isActive, onToggle, onEdit, onDelete, onExport, isExporting }) => {
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

  const handleExportClick = (format) => {
    setShowExportMenu(false);
    onExport(format);
  };

  return (
    <div className="layer-item-wrapper">
      <motion.div
        className="layer-toggle"
        whileHover={{ backgroundColor: 'rgba(0, 0, 0, 0.01)' }}
        onClick={() => onToggle(!isActive)}
      >
        <div className="layer-info">
          <div className="layer-icon" style={{ color: domainColor }}>
            <i className={layer.icon}></i>
          </div>
          <span className="layer-name">{formatLayerName(layer.name)}</span>
        </div>
        <motion.button
          className={`toggle-switch ${isActive ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!isActive);
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            backgroundColor: isActive ? domainColor : '#e5e7eb'
          }}
        >
          <motion.div
            className="toggle-knob"
            initial={false}
            animate={{
              x: isActive ? 18 : 0,
              backgroundColor: '#ffffff'
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </motion.button>
      </motion.div>
      
      <div className="layer-actions">
        <motion.button
          className="layer-action-btn edit"
          onClick={onEdit}
          title="Edit layer"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <i className="fas fa-edit"></i>
          <span>Edit</span>
        </motion.button>
        
        <div className="export-menu-wrapper" ref={exportMenuRef}>
          <AnimatePresence>
            {showExportMenu && (
              <motion.div
                className="export-dropdown"
                initial={{ opacity: 0, y: 5, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 5, scale: 0.95 }}
                transition={{ duration: 0.15 }}
              >
                <button
                  className="export-option"
                  onClick={() => handleExportClick('parquet')}
                >
                  <i className="fas fa-database"></i>
                  <span className="format-label">Parquet</span>
                  <span className="format-ext">.parquet</span>
                </button>
                <button
                  className="export-option"
                  onClick={() => handleExportClick('csv')}
                >
                  <i className="fas fa-file-csv"></i>
                  <span className="format-label">CSV</span>
                  <span className="format-ext">.csv</span>
                </button>
                <button
                  className="export-option"
                  onClick={() => handleExportClick('geojson')}
                >
                  <i className="fas fa-map-marked"></i>
                  <span className="format-label">GeoJSON</span>
                  <span className="format-ext">.geojson</span>
                </button>
                <button
                  className="export-option"
                  onClick={() => handleExportClick('shapefile')}
                >
                  <i className="fas fa-globe"></i>
                  <span className="format-label">Shapefile</span>
                  <span className="format-ext">.zip</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          
          <motion.button
            className="layer-action-btn export"
            onClick={() => setShowExportMenu(!showExportMenu)}
            title="Export layer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <i className="fas fa-download"></i>
                <span>Export</span>
              </>
            )}
          </motion.button>
        </div>
        
        <motion.button
          className="layer-action-btn delete"
          onClick={onDelete}
          title="Delete layer"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <i className="fas fa-trash"></i>
          <span>Delete</span>
        </motion.button>
      </div>
    </div>
  );
};

export default LayerToggle;