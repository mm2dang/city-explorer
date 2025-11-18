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
    
    // Filter to only include point, polygon, and multipolygon results
    const filteredResults = response.data.filter(result => {
      // If no geojson, exclude it
      if (!result.geojson) {
        return false;
      }
      // Only include Point and Polygon and MultiPolygon geometries
      return result.geojson.type === 'Point' || result.geojson.type === 'Polygon' || result.geojson.type === 'MultiPolygon';
    });
    
    return filteredResults;
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
          prop: 'text',
          format: 'json',
          origin: '*',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15000
      });
  
      const html = response.data.parse?.text?.['*'];
      if (!html) {
        return { population: null, size: null, url: null };
      }
  
      console.log(`Fetching Wikipedia data for: ${title}`);
  
      // Helper function to decode HTML entities
      const decodeHtmlEntities = (text) => {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
      };
  
      // Helper function to clean text
      const cleanText = (text) => {
        return decodeHtmlEntities(text)
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      };
  
      // Extract table rows
      const tableRowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows = html.match(tableRowRegex) || [];
  
      let population = null;
      let size = null;
  
      // Extract population - look for "Total" followed by a number in the same row
      for (const row of rows) {
        const cleanRow = cleanText(row);
        
        // Look for rows with "Total" and a population number
        if (/•\s*total/i.test(cleanRow)) {
          // Skip density rows
          if (/density/i.test(cleanRow)) {
            continue;
          }
          
          // Extract number after "Total"
          const numberMatches = cleanRow.match(/total\s+(\d{1,3}(?:,\d{3})+|\d{5,})/i);
          
          if (numberMatches) {
            const num = parseInt(numberMatches[1].replace(/,/g, ''), 10);
            
            // Valid population range: 10,000 to 100,000,000
            if (num >= 10000 && num < 100000000) {
              population = num;
              console.log(`Found population: ${num} from row: ${cleanRow.substring(0, 150)}`);
              break;
            }
          }
        }
      }
  
      // Extract area - look specifically for "• Total" followed by area value
      for (const row of rows) {
        // Must contain "area" somewhere in the row
        if (!/area/i.test(row)) continue;
        
        const cleanRow = cleanText(row);
        
        // Skip rows that aren't the main area row
        if (/rank|code|government|article|postcode/i.test(cleanRow)) {
          continue;
        }
        
        // Look for "• Total" followed by a number and km or sq mi
        // Patterns: "• Total 631.10 km2" or "• Total 45 sq mi (116 km2)"
        const totalAreaMatch = cleanRow.match(/•\s*total\s+(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:km|sq)/i);
        
        if (totalAreaMatch) {
          const num = parseFloat(totalAreaMatch[1].replace(/,/g, ''));
          
          // Check if it's in sq mi - if so, look for km2 in parentheses
          if (/sq\s*mi/i.test(cleanRow)) {
            const kmMatch = cleanRow.match(/\(\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*km/i);
            if (kmMatch) {
              const kmNum = parseFloat(kmMatch[1].replace(/,/g, ''));
              if (kmNum >= 1 && kmNum < 100000) {
                size = kmNum;
                console.log(`Found area: ${kmNum} km² (converted from sq mi) from row: ${cleanRow.substring(0, 150)}`);
                break;
              }
            }
          } else if (num >= 1 && num < 100000) {
            // Already in km
            size = num;
            console.log(`Found area: ${num} km² from row: ${cleanRow.substring(0, 150)}`);
            break;
          }
        }
      }
  
      // If we still don't have area, search for any row with area indicators and units
      // The area value is often in a separate row from the "Area" header
      if (!size) {
        console.log('Searching for area data in any row...');
        
        for (const row of rows) {
          const cleanRow = cleanText(row);
          
          // Look for rows with area indicators (• Total, • City, • Capital City, • Metropolis, or just "Area")
          // AND area units (km or sq mi)
          const hasAreaIndicator = /•\s*(?:total|city|capital\s+city|metropolis|land|water|urban)\b/i.test(cleanRow) || /\barea\b/i.test(cleanRow);
          const hasAreaUnits = /km/i.test(cleanRow) || /sq\s*mi/i.test(cleanRow);
          
          if (hasAreaIndicator && hasAreaUnits) {
            console.log(`Found area candidate: ${cleanRow.substring(0, 150)}`);
            
            // Skip if this is clearly population or other non-area data
            if (/census|population|density|rank|code/i.test(cleanRow) && !/km|sq\s*mi/i.test(cleanRow.substring(0, 100))) {
              console.log('  -> Skipped: not area data');
              continue;
            }
            
            // Skip CMA, metro, urban area - we want city proper
            if (/•\s*(?:cma|metro|urban)\b/i.test(cleanRow)) {
              console.log('  -> Skipped: CMA/metro/urban area');
              continue;
            }
            
            // Pattern 1: "• Total 631.10 km2 (243.67 sq mi)" or "• City 100 km2" or "• Capital City 200 km2"
            const kmFirstMatch = cleanRow.match(/•\s*(?:total|city|capital\s+city|metropolis|land|water)\s+(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*km/i);
            if (kmFirstMatch) {
              const num = parseFloat(kmFirstMatch[1].replace(/,/g, ''));
              if (num >= 1 && num < 100000) {
                size = num;
                console.log(`Found area: ${num} km² (pattern: km first)`);
                break;
              }
            }
            
            // Pattern 2: "• Total 45 sq mi (116 km2)" - extract km from parentheses
            const sqMiFirstMatch = cleanRow.match(/•\s*(?:total|city|capital\s+city|metropolis|land|water)\s+\d+(?:\.\d+)?\s*sq\s*mi\s*\(\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*km/i);
            if (sqMiFirstMatch) {
              const num = parseFloat(sqMiFirstMatch[1].replace(/,/g, ''));
              if (num >= 1 && num < 100000) {
                size = num;
                console.log(`Found area: ${num} km² (pattern: converted from sq mi)`);
                break;
              }
            }
            
            // Pattern 3: Just "Area" followed by a number and km (less common)
            if (/\barea\b/i.test(cleanRow) && !/•/.test(cleanRow)) {
              const areaMatch = cleanRow.match(/area\D*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*km/i);
              if (areaMatch) {
                const num = parseFloat(areaMatch[1].replace(/,/g, ''));
                if (num >= 1 && num < 100000) {
                  size = num;
                  console.log(`Found area: ${num} km² (pattern: Area keyword)`);
                  break;
                }
              }
            }
          }
        }
      }
      
      // Final fallback: look for any row with "Total" and area, extract from cells
      if (!size) {
        console.log('Final fallback: searching table cells...');
        
        for (const row of rows) {
          const cleanRow = cleanText(row);
          
          // Must have "Total" in the row somewhere
          if (!/•\s*total/i.test(cleanRow)) continue;
          
          // Extract ALL table cells from this row
          const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          const cells = row.match(tdRegex) || [];
          
          console.log(`Checking ${cells.length} cells in row with "• Total"`);
          
          // Debug: log all cells
          cells.forEach((cell, i) => {
            const cellText = cleanText(cell);
            if (cellText.length > 0) {
              console.log(`  Cell ${i}: ${cellText.substring(0, 100)}`);
            }
          });
          
          // Look through cells for the number after we've seen "Total"
          let foundTotal = false;
          for (const cell of cells) {
            const cleanCell = cleanText(cell);
            
            if (/•\s*total/i.test(cleanCell)) {
              foundTotal = true;
              // Check if number is in same cell
              const match = cleanCell.match(/total\s+(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:km|sq)/i);
              if (match) {
                const num = parseFloat(match[1].replace(/,/g, ''));
                
                // Check for km in parentheses if it's sq mi
                if (/sq\s*mi/i.test(cleanCell)) {
                  const kmMatch = cleanCell.match(/\(\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*km/i);
                  if (kmMatch) {
                    const kmNum = parseFloat(kmMatch[1].replace(/,/g, ''));
                    if (kmNum >= 1 && kmNum < 100000) {
                      size = kmNum;
                      console.log(`Found area (same cell): ${kmNum} km²`);
                      break;
                    }
                  }
                } else if (num >= 1 && num < 100000) {
                  size = num;
                  console.log(`Found area (same cell): ${num} km²`);
                  break;
                }
              }
              continue;
            }
            
            // If we found "Total" in previous cell, this cell should have the number
            if (foundTotal) {
              // Look for number with km or sq mi
              const kmMatch = cleanCell.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*km/i);
              const sqMiMatch = cleanCell.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*sq\s*mi.*?\(\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*km/i);
              
              if (sqMiMatch) {
                // Has both sq mi and km in parentheses - use km
                const num = parseFloat(sqMiMatch[2].replace(/,/g, ''));
                if (num >= 1 && num < 100000) {
                  size = num;
                  console.log(`Found area (next cell, converted): ${num} km²`);
                  break;
                }
              } else if (kmMatch) {
                const num = parseFloat(kmMatch[1].replace(/,/g, ''));
                if (num >= 1 && num < 100000 && !/cma|metro|urban/i.test(cleanCell)) {
                  size = num;
                  console.log(`Found area (next cell): ${num} km²`);
                  break;
                }
              }
            }
          }
          
          if (size) break;
        }
      }
  
      const encodedTitle = encodeURIComponent(title.replace(/ /g, '_'));
      const url = `https://en.wikipedia.org/wiki/${encodedTitle}`;
  
      console.log(`Wikipedia extraction results for ${title}:`, { population, size, url });
      return { population, size, url };
  
    } catch (error) {
      console.warn(`Error fetching Wikipedia data for ${title}:`, error);
      return { population: null, size: null, url: null };
    }
  };

// Try different variations of the city name
const variations = generateCityVariations(cityName);

  for (const variation of variations) {
    try {
      if (await checkWikipediaPage(variation)) {
        const data = await fetchPageData(variation);
        if (data.population || data.size || data.url) {
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
  return { population: null, size: null, url: null };
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
    let allCoords = [];
    
    if (boundary.type === 'Polygon') {
      // Single polygon - use outer ring
      allCoords = boundary.coordinates[0];
    } else if (boundary.type === 'MultiPolygon') {
      // Multiple polygons - collect all outer rings
      for (const polygon of boundary.coordinates) {
        allCoords.push(...polygon[0]);
      }
    } else {
      console.error('Unsupported boundary type:', boundary.type);
      return null;
    }
    
    if (allCoords.length === 0) {
      console.error('No coordinates found in boundary');
      return null;
    }
    
    const lons = allCoords.map(([lon]) => lon);
    const lats = allCoords.map(([, lat]) => lat);
    
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

    // Create Turf boundary feature for intersection tests
    const boundaryFeature = {
      type: 'Feature',
      geometry: boundary,
      properties: {}
    };

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

        // Check if point is within boundary (works for both Polygon and MultiPolygon)
        const point = turf.point(coordinates);
        
        let isInside = false;
        try {
          // booleanPointInPolygon and booleanWithin work with MultiPolygon
          if (boundary.type === 'MultiPolygon') {
            isInside = turf.booleanPointInPolygon(point, boundaryFeature);
          } else {
            isInside = turf.booleanWithin(point, boundary) || turf.booleanIntersects(point, boundary);
          }
        } catch (error) {
          console.warn('Error checking point intersection:', error);
          continue;
        }
        
        if (!isInside) {
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