import React, { useState, useEffect } from 'react';
import './styles/App.css';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MapViewer from './components/MapViewer';
import AddCityWizard from './components/AddCityWizard';
import LayerModal from './components/LayerModal';
import {
getAllCitiesWithDataStatus,
loadCityFeatures,
saveCityData,
deleteCityData,
processCityFeatures,
cancelCityProcessing,
getAvailableLayersForCity,
saveCustomLayer,
deleteLayer,
loadLayerForEditing,
moveCityData,
setDataSource
} from './utils/s3';

function App() {
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
  const [activeLayers, setActiveLayers] = useState({});
  const [features, setFeatures] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddCityWizard, setShowAddCityWizard] = useState(false);
  const [showLayerModal, setShowLayerModal] = useState(false);
  const [editingCity, setEditingCity] = useState(null);
  const [cityDataStatus, setCityDataStatus] = useState({});
  const [processingProgress, setProcessingProgress] = useState({});
  const [availableLayers, setAvailableLayers] = useState({});
  const [editingLayer, setEditingLayer] = useState(null);
  const [dataSource, setDataSourceState] = useState('city'); // Default to 'city' (uploaded data)
  const [mapView, setMapView] = useState('street'); // Add map view state

  // Domain colors for consistent styling
  const domainColors = {
    mobility: '#3b82f6',
    governance: '#8b5cf6',
    health: '#ef4444',
    economy: '#f59e0b',
    environment: '#10b981',
    culture: '#ec4899',
    education: '#06b6d4',
    housing: '#6366f1',
    social: '#f97316',
  };

  // Initialize data source on mount
  useEffect(() => {
    // Set default to 'city' on first load
    setDataSource('city');
    setDataSourceState('city');
    console.log('Data source initialized to: city (uploaded data)');
  }, []);

  // Load cities on mount
  useEffect(() => {
    loadCities();
  }, []);

  const loadCities = async () => {
    setIsLoading(true);
    try {
      console.log('Loading cities from S3...');
      const citiesWithStatus = await getAllCitiesWithDataStatus();
      console.log(`Loaded ${citiesWithStatus.length} cities:`, citiesWithStatus);
      setCities(citiesWithStatus);

      // Update city data status
      const newStatus = {};
      citiesWithStatus.forEach(city => {
        newStatus[city.name] = city.hasDataLayers;
      });
      setCityDataStatus(newStatus);
    } catch (error) {
      console.error('Error loading cities:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle data source change
  const handleDataSourceChange = async (newSource) => {
    console.log(`Switching data source from ${dataSource} to ${newSource}`);
    // Update local state
    setDataSourceState(newSource);
    // Update s3.js data source
    setDataSource(newSource);
    // Clear current selection and layers
    setSelectedCity(null);
    setActiveLayers({});
    setFeatures([]);
    setAvailableLayers({});

    // Reload cities from new data source
    setIsLoading(true);
    try {
      const citiesWithStatus = await getAllCitiesWithDataStatus();
      setCities(citiesWithStatus);

      // Update city data status
      const newStatus = {};
      citiesWithStatus.forEach(city => {
        newStatus[city.name] = city.hasDataLayers;
      });
      setCityDataStatus(newStatus);
      console.log(`Loaded ${citiesWithStatus.length} cities from ${newSource} data source`);
    } catch (error) {
      console.error('Error loading cities after data source change:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle map view change
  const handleMapViewChange = (newView) => {
    console.log(`Changing map view to: ${newView}`);
    setMapView(newView);
  };

  const handleCitySelect = async (city) => {
    console.log('City selected:', city.name);
    setSelectedCity(city);
    setActiveLayers({});
    setFeatures([]);

    // Load available layers for the selected city
    try {
      const layers = await getAvailableLayersForCity(city.name);
      console.log('Available layers for city:', layers);
      setAvailableLayers(layers);

      // Enable all layers by default
      const allLayersActive = {};
      Object.keys(layers).forEach(layerName => {
        allLayersActive[layerName] = true;
      });
      setActiveLayers(allLayersActive);

      // Load features for all active layers
      if (Object.keys(allLayersActive).length > 0) {
        setIsLoading(true);
        try {
          const cityFeatures = await loadCityFeatures(city.name, allLayersActive);
          console.log(`Loaded ${cityFeatures.length} features for all layers`);
          setFeatures(cityFeatures);
        } catch (error) {
          console.error('Error loading features:', error);
          setFeatures([]);
        } finally {
          setIsLoading(false);
        }
      }
    } catch (error) {
      console.error('Error loading available layers:', error);
      setAvailableLayers({});
    }
  };

  const handleLayerToggle = async (layerName, isActive) => {
    console.log(`Layer ${layerName} toggled to ${isActive}`);
    const newActiveLayers = {
      ...activeLayers,
      [layerName]: isActive,
    };
    setActiveLayers(newActiveLayers);

    if (selectedCity) {
      setIsLoading(true);
      try {
        const cityFeatures = await loadCityFeatures(selectedCity.name, newActiveLayers);
        console.log(`Loaded ${cityFeatures.length} features for active layers`);
        setFeatures(cityFeatures);
      } catch (error) {
        console.error('Error loading features:', error);
        setFeatures([]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleAddCity = async (cityData, startProcessing) => {
    try {
      console.log('Adding new city:', cityData);
      // Parse city name to get country, province, city
      const parts = cityData.name.split(',').map(p => p.trim());
      let city, province, country;
      if (parts.length === 2) {
        [city, country] = parts;
        province = '';
      } else {
        [city, province, country] = parts;
      }

      // Save city metadata
      await saveCityData(cityData, country, province, city);

      // Reload cities
      await loadCities();

      // Only start processing if callback provided
      if (startProcessing) {
        console.log('Starting background processing for:', cityData.name);
        // Initialize processing progress
        setProcessingProgress(prev => ({
          ...prev,
          [cityData.name]: {
            processed: 0,
            saved: 0,
            total: 0,
            status: 'processing'
          }
        }));

        // Update city data status to show it's processing
        setCityDataStatus(prev => ({
          ...prev,
          [cityData.name]: false
        }));

        // Start processing via callback
        startProcessing((cityName, progress) => {
          console.log(`Processing progress for ${cityName}:`, progress);
          setProcessingProgress(prev => ({
            ...prev,
            [cityName]: progress
          }));

          // Update city data status when processing is complete
          if (progress.status === 'complete' && progress.saved > 0) {
            setCityDataStatus(prev => ({
              ...prev,
              [cityName]: true
            }));
          }
        });
      }

      setShowAddCityWizard(false);
      setEditingCity(null);
    } catch (error) {
      console.error('Error adding city:', error);
      alert(`Error adding city: ${error.message}`);
    }
  };

  const handleEditCity = (city) => {
    console.log('Editing city:', city.name);
    setEditingCity(city);
    setShowAddCityWizard(true);
  };

  const handleUpdateCity = async (updatedCityData, startProcessing) => {
    try {
      console.log('Updating city:', updatedCityData);
      // Parse old and new city names
      const oldParts = editingCity.name.split(',').map(p => p.trim());
      const newParts = updatedCityData.name.split(',').map(p => p.trim());

      let oldCity, oldProvince, oldCountry;
      let newCity, newProvince, newCountry;

      if (oldParts.length === 2) {
        [oldCity, oldCountry] = oldParts;
        oldProvince = '';
      } else {
        [oldCity, oldProvince, oldCountry] = oldParts;
      }

      if (newParts.length === 2) {
        [newCity, newCountry] = newParts;
        newProvince = '';
      } else {
        [newCity, newProvince, newCountry] = newParts;
      }

      // Check if location changed (country/province/city)
      const locationChanged =
        oldCountry !== newCountry ||
        oldProvince !== newProvince ||
        oldCity !== newCity;

      if (locationChanged) {
        console.log('Location changed, moving data...');
        // Move all data to new location
        await moveCityData(
          oldCountry, oldProvince, oldCity,
          newCountry, newProvince, newCity
        );
      }

      // Save updated city metadata
      await saveCityData(updatedCityData, newCountry, newProvince, newCity);

      // Reload cities
      await loadCities();

      // Only start processing if callback provided
      if (startProcessing) {
        console.log('Starting background processing for updated city:', updatedCityData.name);
        setProcessingProgress(prev => ({
          ...prev,
          [updatedCityData.name]: {
            processed: 0,
            saved: 0,
            total: 0,
            status: 'processing'
          }
        }));

        startProcessing((cityName, progress) => {
          console.log(`Processing progress for ${cityName}:`, progress);
          setProcessingProgress(prev => ({
            ...prev,
            [cityName]: progress
          }));

          if (progress.status === 'complete' && progress.saved > 0) {
            setCityDataStatus(prev => ({
              ...prev,
              [cityName]: true
            }));
          }
        });
      }

      // Update selected city if it was the one being edited
      if (selectedCity?.name === editingCity.name) {
        setSelectedCity(null);
        setActiveLayers({});
        setFeatures([]);
      }

      setShowAddCityWizard(false);
      setEditingCity(null);
    } catch (error) {
      console.error('Error updating city:', error);
      alert(`Error updating city: ${error.message}`);
    }
  };

  const handleDeleteCity = async (cityName) => {
    if (!window.confirm(`Are you sure you want to delete ${cityName}? This will remove all data for this city.`)) {
      return;
    }

    try {
      console.log('Deleting city:', cityName);
      // Cancel any active processing
      const wasCancelled = await cancelCityProcessing(cityName);
      if (wasCancelled) {
        console.log('Cancelled active processing for city');
      }

      // Delete city data
      await deleteCityData(cityName);

      // Clear selection if deleted city was selected
      if (selectedCity?.name === cityName) {
        setSelectedCity(null);
        setActiveLayers({});
        setFeatures([]);
      }

      // Remove from processing progress
      setProcessingProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[cityName];
        return newProgress;
      });

      // Reload cities
      await loadCities();
      console.log('City deleted successfully');
    } catch (error) {
      console.error('Error deleting city:', error);
      alert(`Error deleting city: ${error.message}`);
    }
  };

  const handleAddLayer = () => {
    if (!selectedCity) {
      alert('Please select a city first');
      return;
    }

    setEditingLayer(null);
    setShowLayerModal(true);
  };

  const handleEditLayer = async (layerName) => {
    if (!selectedCity) return;

    try {
      console.log(`Loading layer for editing: ${layerName}`);
      const layerInfo = availableLayers[layerName];
      if (!layerInfo) {
        console.error('Layer info not found for:', layerName);
        return;
      }

      // Load the layer features
      const features = await loadLayerForEditing(
        selectedCity.name,
        layerInfo.domain,
        layerName
      );

      setEditingLayer({
        name: layerName,
        domain: layerInfo.domain,
        icon: layerInfo.icon,
        features: features
      });

      setShowLayerModal(true);
    } catch (error) {
      console.error('Error loading layer for editing:', error);
      alert(`Error loading layer: ${error.message}`);
    }
  };

  const handleSaveLayer = async (layerData) => {
    try {
      console.log('Saving custom layer:', layerData);
      if (!selectedCity) {
        throw new Error('No city selected');
      }

      // Save the layer
      await saveCustomLayer(selectedCity.name, layerData, selectedCity.boundary);

      // Reload available layers
      const layers = await getAvailableLayersForCity(selectedCity.name);
      setAvailableLayers(layers);

      // Update city data status to show it has layers
      setCityDataStatus(prev => ({
        ...prev,
        [selectedCity.name]: true
      }));

      // If the layer is currently active, reload features
      if (activeLayers[layerData.name]) {
        const cityFeatures = await loadCityFeatures(selectedCity.name, activeLayers);
        setFeatures(cityFeatures);
      }

      setShowLayerModal(false);
      setEditingLayer(null);
      console.log('Layer saved successfully');
    } catch (error) {
      console.error('Error saving layer:', error);
      alert(`Error saving layer: ${error.message}`);
    }
  };

  const handleDeleteLayer = async (layerName) => {
    if (!selectedCity) return;

    if (!window.confirm(`Are you sure you want to delete the layer "${layerName}"?`)) {
      return;
    }

    try {
      console.log(`Deleting layer: ${layerName}`);
      const layerInfo = availableLayers[layerName];
      if (!layerInfo) {
        console.error('Layer info not found for:', layerName);
        return;
      }

      await deleteLayer(selectedCity.name, layerInfo.domain, layerName);

      // Remove from active layers if it was active
      if (activeLayers[layerName]) {
        const newActiveLayers = { ...activeLayers };
        delete newActiveLayers[layerName];
        setActiveLayers(newActiveLayers);

        // Reload features without this layer
        const cityFeatures = await loadCityFeatures(selectedCity.name, newActiveLayers);
        setFeatures(cityFeatures);
      }

      // Reload available layers
      const layers = await getAvailableLayersForCity(selectedCity.name);
      setAvailableLayers(layers);

      console.log('Layer deleted successfully');
    } catch (error) {
      console.error('Error deleting layer:', error);
      alert(`Error deleting layer: ${error.message}`);
    }
  };

  return (
    <div className="App">
      <Header
        cities={cities}
        selectedCity={selectedCity}
        onCitySelect={handleCitySelect}
        onAddCity={() => {
          console.log('Add City button clicked');
          setShowAddCityWizard(true);
        }}
        onEditCity={handleEditCity}
        onDeleteCity={handleDeleteCity}
        isLoading={isLoading}
        cityDataStatus={cityDataStatus}
        processingProgress={processingProgress}
        dataSource={dataSource}
        onDataSourceChange={handleDataSourceChange}
        mapView={mapView}
        onMapViewChange={handleMapViewChange}
      />

      <div className="main-content">
        <Sidebar
          selectedCity={selectedCity}
          cityBoundary={selectedCity?.boundary}
          activeLayers={activeLayers}
          onLayerToggle={handleLayerToggle}
          onAddLayer={handleAddLayer}
          onEditLayer={handleEditLayer}
          onDeleteLayer={handleDeleteLayer}
          availableLayers={availableLayers}
          domainColors={domainColors}
          onLayerSave={handleSaveLayer}
          onLayerDelete={handleDeleteLayer}
        />

        <MapViewer
          selectedCity={selectedCity}
          features={features}
          isLoading={isLoading}
          activeLayers={activeLayers}
          domainColors={domainColors}
          loadCityFeatures={loadCityFeatures}
          availableLayers={availableLayers}
          mapView={mapView}
        />
      </div>

      {showAddCityWizard && (
        <div className="wizard-overlay">
          <AddCityWizard
            onCancel={() => {
              setShowAddCityWizard(false);
              setEditingCity(null);
            }}
            onComplete={editingCity ? handleUpdateCity : handleAddCity}
            editingCity={editingCity}
          />
        </div>
      )}

      {showLayerModal && (
        <LayerModal
          cityName={selectedCity?.name}
          cityBoundary={selectedCity?.boundary}
          onClose={() => {
            setShowLayerModal(false);
            setEditingLayer(null);
          }}
          onSave={handleSaveLayer}
          editingLayer={editingLayer}
        />
      )}
    </div>
  );
}

export default App;