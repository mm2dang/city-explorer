import axios from 'axios';
import * as turf from '@turf/turf';

const USER_AGENT = 'CityExplorer/1.0 (https://example.com)';

export const searchOSM = async (cityName, province, country) => {
  const query = [cityName, province, country].filter(Boolean).join(', ');
  
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: query,
        format: 'json',
        polygon_geojson: 1,
        limit: 10,
        addressdetails: 1,
      },
      headers: {
        'User-Agent': USER_AGENT,
      },
    });
    
    return response.data;
  } catch (error) {
    throw new Error(`OSM search failed: ${error.message}`);
  }
};

export const fetchOSMBoundary = async (osmId) => {
  const overpassQuery = `
    [out:json][timeout:25];
    relation(${osmId});
    out geom;
  `;
  
  try {
    const response = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(overpassQuery)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
      }
    );
    
    const elements = response.data.elements;
    if (!elements || elements.length === 0) {
      throw new Error('No boundary data found for relation');
    }

    const relation = elements[0];
    if (relation.type !== 'relation' || !relation.members) {
      throw new Error('Invalid relation data');
    }

    // Extract outer ways
    const outerWays = [];
    for (const member of relation.members) {
      if (member.type === 'way' && member.geometry && member.role === 'outer') {
        const coords = member.geometry.map((point) => [point.lon, point.lat]);
        
        // Ensure the ring is closed
        if (
          coords[0][0] !== coords[coords.length - 1][0] ||
          coords[0][1] !== coords[coords.length - 1][1]
        ) {
          coords.push(coords[0]);
        }
        
        if (coords.length >= 4) {
          outerWays.push(coords);
        }
      }
    }

    if (outerWays.length === 0) {
      throw new Error('No valid outer geometry found for relation');
    }

    // Construct GeoJSON
    const geojson = {
      type: outerWays.length === 1 ? 'Polygon' : 'MultiPolygon',
      coordinates: outerWays.length === 1 ? outerWays : [outerWays],
    };

    return geojson;
  } catch (error) {
    throw new Error(`Overpass API failed: ${error.message}`);
  }
};

export const fetchWikipediaData = async (cityName) => {
  const generateCityVariations = (name) => {
    const variations = new Set();
    
    // Split by comma and take first part (main city name)
    const mainName = name.split(',')[0].trim();
    variations.add(mainName);
    
    // Add variations with common suffixes/prefixes
    variations.add(`${mainName} (city)`);
    variations.add(`City of ${mainName}`);
    variations.add(mainName.replace(/\s+/g, '_'));
    variations.add(mainName.toLowerCase());
    
    // Add title case version
    variations.add(mainName.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' '));
    
    // Remove common administrative terms and try again
    const cleanName = mainName.replace(/\b(city|municipality|town|borough)\b/gi, '').trim();
    if (cleanName && cleanName !== mainName) {
      variations.add(cleanName);
      variations.add(`${cleanName} (city)`);
      variations.add(`City of ${cleanName}`);
    }
    
    return [...variations].filter(v => v.length > 0);
  };

  const checkWikipediaPage = async (title) => {
    try {
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          titles: title,
          format: 'json',
          origin: '*',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 10000
      });
      
      const pages = response.data.query.pages;
      return !pages['-1']; // Page exists if there's no -1 key
    } catch (error) {
      console.warn(`Error checking Wikipedia page for ${title}:`, error);
      return false;
    }
  };

  const fetchPageData = async (title) => {
    try {
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'parse',
          page: title,
          prop: 'wikitext',
          format: 'json',
          origin: '*',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15000
      });

      const wikitext = response.data.parse?.wikitext['*'];
      if (!wikitext) return { population: null, size: null };

      // Extract infobox with proper nested brace handling
      const startIndex = wikitext.indexOf('{{Infobox');
      if (startIndex === -1) return { population: null, size: null };

      let braceCount = 0;
      let i = startIndex;
      let infobox = '';

      while (i < wikitext.length && braceCount >= 0) {
        const char = wikitext[i];
        infobox += char;
        if (char === '{' && wikitext[i + 1] === '{') {
          braceCount++;
          i++; // Skip the second brace
        } else if (char === '}' && wikitext[i + 1] === '}') {
          braceCount--;
          i++; // Skip the second brace
        }
        if (braceCount === 0 && infobox.endsWith('}}')) break;
        i++;
      }

      // Extract population and area with better regex patterns
      const popPatterns = [
        /\|\s*population[^=]*=\s*([0-9,]+)/i,
        /\|\s*pop[^=]*=\s*([0-9,]+)/i,
        /\|\s*population_total\s*=\s*([0-9,]+)/i
      ];
      
      const areaPatterns = [
        /\|\s*area[^=]*=\s*([\d.]+)/i,
        /\|\s*area_total[^=]*=\s*([\d.]+)/i,
        /\|\s*area_km2\s*=\s*([\d.]+)/i
      ];

      let population = null;
      let size = null;

      // Try each population pattern
      for (const pattern of popPatterns) {
        const match = infobox.match(pattern);
        if (match) {
          const num = parseInt(match[1].replace(/,/g, ''));
          if (num >= 1000) { // Only accept reasonable population numbers
            population = num;
            break;
          }
        }
      }

      // Try each area pattern
      for (const pattern of areaPatterns) {
        const match = infobox.match(pattern);
        if (match) {
          const num = parseFloat(match[1]);
          if (num > 0 && num < 1000000) { // Reasonable area range
            size = num;
            break;
          }
        }
      }

      return { population, size };
    } catch (error) {
      console.warn(`Error fetching Wikipedia data for ${title}:`, error);
      return { population: null, size: null };
    }
  };

  // Try different variations of the city name
  const variations = generateCityVariations(cityName);
  
  for (const variation of variations) {
    try {
      if (await checkWikipediaPage(variation)) {
        const data = await fetchPageData(variation);
        if (data.population || data.size) {
          console.log(`Found Wikipedia data for ${variation}:`, data);
          return data;
        }
      }
    } catch (error) {
      console.warn(`Error processing variation ${variation}:`, error);
      continue;
    }
  }

  console.log(`No Wikipedia data found for ${cityName}`);
  return { population: null, size: null };
};

// Live feature processing for immediate display
export const processCityFeaturesLive = async (boundary, activeLayerNames) => {
  try {
    // Convert boundary to bounding box for Overpass query
    const bbox = getBoundingBox(boundary);
    if (!bbox) return [];

    // Define layer mappings
    const layerMappings = {
      'roads': { tags: { highway: true }, domain: 'mobility' },
      'sidewalks': { tags: { highway: ['footway'] }, domain: 'mobility' },
      'parking': { tags: { amenity: ['parking'] }, domain: 'mobility' },
      'transit_stops': { tags: { highway: ['bus_stop'] }, domain: 'mobility' },
      'hospitals': { tags: { amenity: ['hospital'] }, domain: 'health' },
      'schools': { tags: { amenity: ['school'] }, domain: 'education' },
      'restaurants': { tags: { amenity: ['restaurant'] }, domain: 'economy' },
      'parks': { tags: { leisure: ['park'] }, domain: 'environment' }
    };

    const features = [];
    
    for (const layerName of activeLayerNames) {
      const layerConfig = layerMappings[layerName];
      if (!layerConfig) continue;

      try {
        const layerFeatures = await fetchLayerFeatures(bbox, layerConfig.tags, layerName, layerConfig.domain, boundary);
        features.push(...layerFeatures);
      } catch (error) {
        console.warn(`Error fetching layer ${layerName}:`, error);
      }
    }

    return features;
  } catch (error) {
    console.error('Error processing live city features:', error);
    return [];
  }
};

const getBoundingBox = (boundary) => {
  try {
    const coords = boundary.type === 'Polygon' 
      ? boundary.coordinates[0]
      : boundary.coordinates[0][0];
    
    const lons = coords.map(([lon]) => lon);
    const lats = coords.map(([, lat]) => lat);
    
    return {
      south: Math.min(...lats),
      west: Math.min(...lons),
      north: Math.max(...lats),
      east: Math.max(...lons)
    };
  } catch (error) {
    console.error('Error calculating bounding box:', error);
    return null;
  }
};

// Helper function to build tag query (fixes eslint loop warning)
const buildTagQuery = (tags) => {
  let tagQuery = '';
  const tagEntries = Object.entries(tags);
  
  tagEntries.forEach(([key, value]) => {
    if (value === true) {
      tagQuery += `[${key}]`;
    } else if (Array.isArray(value)) {
      value.forEach((val) => {
        tagQuery += `[${key}="${val}"]`;
      });
    } else {
      tagQuery += `[${key}="${value}"]`;
    }
  });
  
  return tagQuery;
};

const fetchLayerFeatures = async (bbox, tags, layerName, domain, boundary) => {
  try {
    // Build tag query using helper function to avoid unsafe loop reference
    const tagQuery = buildTagQuery(tags);

    const bboxString = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    const query = `
      [out:json][timeout:15];
      (
        nwr${tagQuery}(${bboxString});
      );
      out geom;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.statusText}`);
    }

    const data = await response.json();
    const features = [];

    for (const element of data.elements) {
      try {
        // Create point geometry (centroid for polygons/ways)
        let coordinates;
        
        if (element.type === 'node') {
          coordinates = [element.lon, element.lat];
        } else if (element.type === 'way' && element.geometry) {
          const coords = element.geometry.map(g => [g.lon, g.lat]);
          if (coords.length >= 4 && coords[0][0] === coords[coords.length-1][0] && coords[0][1] === coords[coords.length-1][1]) {
            // Closed way (polygon) - get centroid
            const polygon = turf.polygon([coords]);
            const centroid = turf.centroid(polygon);
            coordinates = centroid.geometry.coordinates;
          } else {
            // Open way (line) - get midpoint
            const line = turf.lineString(coords);
            const midpoint = turf.along(line, turf.length(line) / 2);
            coordinates = midpoint.geometry.coordinates;
          }
        } else if (element.type === 'relation' && element.geometry) {
          // Use first coordinate or calculate centroid
          const coords = element.geometry.map(g => [g.lon, g.lat]);
          if (coords.length > 0) {
            const points = turf.points(coords);
            const centroid = turf.centroid(points);
            coordinates = centroid.geometry.coordinates;
          }
        }

        if (!coordinates) continue;

        // Check if point is within boundary
        const point = turf.point(coordinates);
        if (!turf.booleanWithin(point, boundary) && !turf.booleanIntersects(point, boundary)) {
          continue;
        }

        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: coordinates
          },
          properties: {
            feature_name: element.tags?.name || null,
            layer_name: layerName,
            domain_name: domain
          }
        });
      } catch (error) {
        console.warn('Error processing element:', error);
        continue;
      }
    }

    return features;
  } catch (error) {
    console.error(`Error fetching features for ${layerName}:`, error);
    return [];
  }
};