import React from 'react';
import { motion } from 'framer-motion';

const LayerToggle = ({ layer, domainColor, isActive, onToggle }) => {
  const formatLayerName = (name) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <motion.div
      className="layer-toggle"
      whileHover={{ backgroundColor: 'rgba(0, 0, 0, 0.02)' }}
    >
      <div className="layer-info">
        <div className="layer-icon" style={{ color: domainColor }}>
          <i className={layer.icon}></i>
        </div>
        <span className="layer-name">{formatLayerName(layer.name)}</span>
      </div>
      
      <motion.button
        className={`toggle-switch ${isActive ? 'active' : ''}`}
        onClick={() => onToggle(!isActive)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        style={{
          backgroundColor: isActive ? domainColor : '#e5e7eb'
        }}
      >
        <motion.div
          className="toggle-knob"
          initial={false}
          animate={{
            x: isActive ? 14 : 0,
            backgroundColor: isActive ? '#ffffff' : '#ffffff'
          }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </motion.button>
    </motion.div>
  );
};

export default LayerToggle;