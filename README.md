# CityExplorer

A modern web application for exploring and analyzing urban data across multiple domains. CityExplorer allows you to add cities, process geographic features from OpenStreetMap, and visualize urban infrastructure layers on an interactive map.

## File Structure

```
cityexplorer/
├── public/
│   ├── index.html
│   ├── manifest.json
│   └── worker.js                     # Web Worker for OSM data processing
├── src/
│   ├── components/
│   │   ├── Header.js                 # City selector and status display
│   │   ├── Sidebar.js                # Domain and layer controls
│   │   ├── IndicatorsSidebar.js      # Mobile ping indicator controls
│   │   ├── MapViewer.js              # Leaflet map with clustering
│   │   ├── AddCityWizard.js          # Multi-step city creation wizard
│   │   ├── LayerToggle.js            # Individual layer toggle component
│   │   └── LayerModal.js             # Add / edit layer wizard
│   ├── utils/
│   │   ├── s3.js                     # AWS S3 operations and data processing
│   │   ├── indicators.js             # AWS mobile ping data operations
│   │   ├── osm.js                    # OpenStreetMap and Wikipedia API calls
│   │   ├── regions.js                # UN SDG region mapping
│   │   └── exportUtils.js            # Export layers to local computer
│   ├── styles/
│   │   ├── AddCityWizard.css
│   │   ├── App.css
│   │   ├── Header.css
│   │   ├── IndicatorsSidebar.css
│   │   ├── leaflet.css
│   │   ├── LayerModal.css
│   │   ├── MapViewer.css
│   │   └── Sidebar.css
│   ├── App.js                        # Main application component
│   └── index.js                      # React entry point
├── package.json
├── .env                              # Environment variables
└── README.md
```

## Features

- **Interactive Map Visualization**: Explore city boundaries and feature layers using Leaflet
- **Add City Wizard**: Search for cities, define boundaries (upload GeoJSON or draw), and automatically fetch population data
- **Real-time Processing**: Background data processing with live progress updates
- **Multi-Domain Analysis**: View and edit urban features across 9 domains (mobility, governance, health, economy, environment, culture, education, housing, social)
- **41 Layer Types**: From roads and parks to hospitals and schools
- **Mobile Ping Analysis**: Calculate and display mobile ping indicators
- **S3 Data Storage**: Efficient Parquet format with Snappy compression
- **Responsive Design**: Modern UI with smooth animations

## Domain Colors

- **Mobility**: Yellow (#fdd900) 
- **Governance**: Teal Blue (#005670)
- **Health**: Peach (#ffdb9d)
- **Social**: Light Pink (#f49ac1)
- **Environment**: Green (#3aaa35)
- **Economy**: Light Blue (#00b2e2)
- **Education**: Orange (#ff8000)
- **Housing**: Light Green (#b3d7b1)
- **Culture**: Magenta (#e33e7f)

## Setup

1. Clone the repository
```bash
git clone https://github.com/mm2dang/city-explorer
cd cityexplorer
```
2. Install dependencies
```bash
npm install
```
3. Create a .env file in the project root:
```
# AWS Configuration
REACT_APP_AWS_REGION=us-east-1
REACT_APP_AWS_ACCESS_KEY_ID=your_access_key
REACT_APP_AWS_SECRET_ACCESS_KEY=your_secret_key
REACT_APP_AWS_SESSION_TOKEN=your_session_token

# S3 Bucket Configuration
REACT_APP_S3_BUCKET_NAME=qoli-mobile-ping-geometries-dev
REACT_APP_S3_RESULT_BUCKET_NAME=qoli-mobile-ping-indicators-dev

# API Configuration (optional, defaults provided)
REACT_APP_OVERPASS_API_URL=https://overpass-api.de/api/interpreter
REACT_APP_NOMINATIM_API_URL=https://nominatim.openstreetmap.org
REACT_APP_WIKIPEDIA_API_URL=https://en.wikipedia.org/w/api.php

# Application Configuration (optional)
REACT_APP_MAX_CITIES=100
REACT_APP_MAX_FEATURES_PER_DOMAIN=10000
```
4. Run the development server
```bash
npm start
```
5. Open http://localhost:3000 in your browser

## Development

1. Clone the repo
```bash
git clone https://github.com/mm2dang/city-explorer
cd cityexplorer
```
2. Edit the code locally
3. Check changes
```bash
git status
```
4. Stage the changes
```bash
git add .
```
5. Commit changes
```bash
git commit -m "Describe update here"
```
6. Push to GitHub
```bash
git push origin main
```

## Usage

### Adding a City

1. Click "Add City" in the header or select a city from the world map
2. Step 1 - Search: Enter city name, province/state, and country. Search OpenStreetMap for results
3. Step 2 - Details: Review/edit population and area (auto-fetched from Wikipedia)
4. Step 3 - Boundary: Upload a GeoJSON file or draw the city boundary on the map
5. Click "Add City" to save

The app will:
- Save city metadata to S3
- Optionally, start processing 41 feature layers in the background
- Show real-time progress in the header dropdown if processing

### Viewing Map Data
1. Select the data source and map view (street or satellite) from the settings in the header
2. Select a city from the header dropdown
3. The map will zoom to the city boundary
4. Use the layers sidebar to toggle layers individually or by domain, or export layers in a supported format (csv, parquet, geojson, shp)
5. Markers will cluster automatically and show feature details on click

#### Adding/Editing Map Layers
1. Select a city from the header dropdown or the world map
2. From the layers sidebar, select "Add Layer" / an add icon for an existing domain, or select the edit icon beside any existing layer (skip to Step 3)
3. Step 1 - Select the domain and a predefined layer name, or select "Add Custom Layer" to type a custom layer name and choose an icon
4. Step 2 - Choose to upload a file or draw on a map (skip to Step 4)
   a. Step 2a - If "Upload file" was selected, upload a file in a supported format (csv, parquet, geojson, shp), and choose to append/replace existing features
5. Step 3 - Draw features on a map, or click on features to edit their names
6. Click "Save Layer" to save

### Managing Mobile Ping Indicators

For all cities:
1. Click "Calculate Indicators" in the indicators sidebar
2. Select an available date range to view and search results in the indicators sidebar, and optionally export it to a supported format (csv, parquet, json)

For individual cities:
1. Select a city from the header dropdown or the world map
2. Click "Calculate Indicators" in the indicators sidebar
3. View indicator results for the selected city in the indicators sidebar, and optionally export it to a supported format (csv, parquet, json)

## Data Storage

### S3 Bucket Structure
#### Geometries Bucket
```
s3://qoli-mobile-ping-geometries-dev
├── osm/
│   ├── population/
│   │   └── country={country}/
│   │       └── province={province}/
│   │           └── city={city}/
│   │               └── city_data.snappy.parquet
│   │
│   └── data/
│       └── country={country}/
│           └── province={province}/
│               └── city={city}/
│                   └── domain={domain}/
│                       ├── roads.snappy.parquet
│                       ├── parks.snappy.parquet
│                       └── ... (other layers)
│
└──  city/
    ├── population/
    │   └── country={country}/
    │       └── province={province}/
    │           └── city={city}/
    │               └── city_data.snappy.parquet
    │
    └── data/
        └── country={country}/
            └── province={province}/
                └── city={city}/
                    └── domain={domain}/
                        ├── roads.snappy.parquet
                        ├── parks.snappy.parquet
                        └── ... (other layers)

```

#### Results Bucket
```
qoli-mobile-ping-indicators-dev
├── osm/
|    └── summary/
|       └── {start-date_to_end-date}/
|            ├── part-00000-00000000-0000-0000-0000-000000000000-0000.csv.gz
|            └── ... (other .csv.gz files)
|
└──  city/
    └── summary/
        └── {start-date_to_end-date}/
            ├── part-00000-00000000-0000-0000-0000-000000000000-0000.csv.gz
            └── ... (other .csv.gz files)
```

### Parquet Schema
#### City Data
**File name**: `city_data.snappy.parquet`
**Fields**: 
- `name`: string
- `longitude`: float
- `latitude`: float
- `boundary`: string (GeoJSON geometry)
- `population`: int (nullable)
- `size`: float (nullable, km²)
- `sdg_region`: string

#### Feature Data
**File name**: ex. `roads.snappy.parquet`
**Fields**:
- `feature_name`: string (nullable)
- `geometry_type`: string (Point, LineString, Polygon, Multi*)
- `longitude`: float (representative point)
- `latitude`: float (representative point)
- `geometry_coordinates`: string (complete GeoJSON geometry)
- `layer_name`: string
- `domain_name`: string

### Result Summary
**File name**: ex. `part-00000-00000000-0000-0000-0000-000000000000-0000.csv.gz`
**Fields**
- `city`: string
- `province`: string
- `country`: string
- `out_at_night`: float
- `leisure_dwell_time`: float
- `cultural_visits`: float
- `coverage`: float
- `speed`: float
- `latency`: float

## Technologies Used

- **React 18**: UI framework
- **Leaflet**: Interactive maps with marker clustering
- **React Leaflet**: React bindings for Leaflet
- **Leaflet Draw**: Boundary drawing tools
- **Framer Motion**: Smooth animations
- **AWS SDK v3**: S3 operations
- **Parquet-WASM**: Client-side Parquet read/write
- **Apache Arrow**: Columnar data processing
- **Turf.js**: Geospatial analysis
- **OpenStreetMap APIs**: Nominatim (geocoding), Overpass (features)
- **Wikipedia API**: Population data enrichment