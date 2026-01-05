// Global state
let userLocation = null;
const TWILIGHT_ALTITUDE = -18; // Astronomical twilight
const VISIBILITY_THRESHOLD = 15; // Degrees above horizon to be considered "good" visibility

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('getLocationBtn').addEventListener('click', getUserLocation);
    document.getElementById('setManualLocationBtn').addEventListener('click', setManualLocation);
    
    // Auto-load if we can (optional, but button is safer for permissions)
    const savedLoc = localStorage.getItem('messier_user_loc');
    if (savedLoc) {
        userLocation = JSON.parse(savedLoc);
        populateInputs(userLocation);
        updateUI();
    }
});

function getUserLocation() {
    const status = document.getElementById('status');
    status.textContent = "Locating...";
    
    if (!navigator.geolocation) {
        status.textContent = "Geolocation is not supported by your browser";
        return;
    }

    navigator.geolocation.getCurrentPosition((position) => {
        userLocation = {
            lat: position.coords.latitude,
            lon: position.coords.longitude
        };
        localStorage.setItem('messier_user_loc', JSON.stringify(userLocation));
        status.textContent = "Location found!";
        populateInputs(userLocation);
        updateUI();
        
        // Fetch city name
        fetchCityName(userLocation.lat, userLocation.lon).then(city => {
            if (city) {
                userLocation.city = city;
                localStorage.setItem('messier_user_loc', JSON.stringify(userLocation));
                populateInputs(userLocation);
                updateUI();
            }
        });
    }, (error) => {
        status.textContent = "Unable to retrieve your location: " + error.message;
        // Default to Greenwich for demo purposes if failed
        // userLocation = { lat: 51.4934, lon: 0.0098 };
        // updateUI();
    });
}

function setManualLocation() {
    const lat = parseFloat(document.getElementById('lat-input').value);
    const lon = parseFloat(document.getElementById('lon-input').value);
    const city = document.getElementById('city-input').value;
    const status = document.getElementById('status');

    if (isNaN(lat) || isNaN(lon)) {
        status.textContent = "Please enter valid latitude and longitude.";
        status.classList.add('warning');
        return;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        status.textContent = "Coordinates out of range.";
        status.classList.add('warning');
        return;
    }

    status.classList.remove('warning');
    userLocation = { lat, lon, city };
    localStorage.setItem('messier_user_loc', JSON.stringify(userLocation));
    status.textContent = "Manual location set!";
    updateUI();
}

function populateInputs(loc) {
    if (!loc) return;
    document.getElementById('lat-input').value = loc.lat.toFixed(4);
    document.getElementById('lon-input').value = loc.lon.toFixed(4);
    document.getElementById('city-input').value = loc.city || '';
}

async function fetchCityName(lat, lon) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.address.city || data.address.town || data.address.village || data.address.county || "Unknown Location";
    } catch (e) {
        console.error("City fetch failed", e);
        return null;
    }
}

function updateUI() {
    if (!userLocation) return;

    const dateDisplay = document.getElementById('date-display');
    const locationDisplay = document.getElementById('location-display');
    const twilightDisplay = document.getElementById('twilight-display');
    const timeline = document.getElementById('timeline');
    const infoPanel = document.getElementById('info-panel');

    const now = new Date();
    dateDisplay.textContent = now.toLocaleDateString();
    
    let locText = `${userLocation.lat.toFixed(2)}°, ${userLocation.lon.toFixed(2)}°`;
    if (userLocation.city) {
        locText += ` (${userLocation.city})`;
    }
    locationDisplay.textContent = locText;

    infoPanel.classList.remove('hidden');

    // 1. Calculate Sun Times (Twilight)
    const sunTimes = Astronomy.getTwilightTimes(now, userLocation.lat, userLocation.lon);
    
    if (!sunTimes.dusk || !sunTimes.dawn) {
        twilightDisplay.textContent = "No astronomical dark window tonight (Latitude too high/season).";
        timeline.innerHTML = "<p class='warning'>No true darkness tonight. Objects may be washed out.</p>";
        // Could still show objects, but let's warn.
        // If we want to show anyway, we can fallback to nautical (-12) or civil (-6)
        // For now, let's assume we proceed but mark hours as "Bright".
    } else {
        const duskStr = sunTimes.dusk.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const dawnStr = sunTimes.dawn.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        twilightDisplay.textContent = `${duskStr} - ${dawnStr}`;
    }

    // 2. Generate Timeline
    // We want to show from Dusk to Dawn (or 6 PM to 6 AM if undefined/perpetual night)
    let startTime = sunTimes.dusk ? new Date(sunTimes.dusk) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
    let endTime = sunTimes.dawn ? new Date(sunTimes.dawn) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 6, 0, 0);

    // Handle wrap around midnight if dusk is after dawn (shouldn't happen with correct logic, but careful)
    if (endTime < startTime) endTime.setDate(endTime.getDate() + 1);

    timeline.innerHTML = '';
    
    // Iterate by hour
    let current = new Date(startTime);
    // Round up to next hour
    current.setMinutes(0, 0, 0);
    if (current < startTime) current.setHours(current.getHours() + 1);

    let hasHours = false;

    while (current < endTime) {
        hasHours = true;
        
        // Calculate visible objects
        const visibleObjects = getVisibleObjects(current, userLocation);
        
        const hourDiv = document.createElement('div');
        hourDiv.className = 'timeline-hour';
        
        const hourHeader = document.createElement('div');
        hourHeader.className = 'hour-header';
        // Add object count to header
        hourHeader.textContent = `${current.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})} — ${visibleObjects.length} Objects`;
        hourDiv.appendChild(hourHeader);

        const objectList = document.createElement('div');
        objectList.className = 'object-list';

        if (visibleObjects.length === 0) {
            objectList.innerHTML = "<p style='padding:10px; color:#64748b;'>No Messier objects high enough.</p>";
        } else {
            // Group by type
            const grouped = visibleObjects.reduce((acc, obj) => {
                const type = obj.type;
                if (!acc[type]) acc[type] = [];
                acc[type].push(obj);
                return acc;
            }, {});

            // Sort types alphabetically
            const sortedTypes = Object.keys(grouped).sort();

            sortedTypes.forEach(type => {
                // Create Group Header
                const typeHeader = document.createElement('div');
                typeHeader.className = 'type-header';
                typeHeader.style.cssText = "grid-column: 1 / -1; padding: 10px 0 5px 0; color: #94a3b8; font-weight: bold; border-bottom: 1px solid #334155; margin-bottom: 5px;";
                typeHeader.textContent = `${type} (${grouped[type].length})`;
                objectList.appendChild(typeHeader);

                // Add objects for this type
                grouped[type].forEach(obj => {
                    const item = document.createElement('div');
                    item.className = 'messier-item';
                    const wikiUrl = `https://en.wikipedia.org/wiki/Messier_${obj.id.substring(1)}`;
                    
                    item.innerHTML = `
                        <a href="${wikiUrl}" target="_blank" title="View on Wikipedia">
                            <img src="" data-messier-id="${obj.id}" class="messier-thumb" alt="${obj.id}" onerror="this.style.display='none'">
                        </a>
                        <div class="messier-info">
                            <div class="messier-id">
                                <a href="${wikiUrl}" target="_blank" title="View on Wikipedia">${obj.id}</a>
                            </div>
                            <div class="messier-details">Alt: ${obj.alt.toFixed(1)}°</div>
                            <div class="messier-details">Mag: ${obj.mag}</div>
                            <div class="messier-details">${obj.constellation}</div>
                        </div>
                    `;
                    objectList.appendChild(item);
                });
            });
        }

        hourDiv.appendChild(objectList);
        timeline.appendChild(hourDiv);

        current.setHours(current.getHours() + 1);
    }

    // Trigger image loading after render
    loadImages();

    if (!hasHours) {
        timeline.innerHTML += "<p class='warning'>Night is too short for hourly intervals.</p>";
    }
}

// Image Loading & Caching System
async function loadImages() {
    const images = document.querySelectorAll('img.messier-thumb[src=""]');
    
    // Process in chunks to avoid spamming network too hard? 
    // Browsers handle concurrent limits, but let's be nice.
    for (const img of images) {
        const id = img.getAttribute('data-messier-id');
        if (!id) continue;

        const cachedUrl = localStorage.getItem(`messier_img_${id}`);
        if (cachedUrl) {
            img.src = cachedUrl;
        } else {
            // Fetch with a slight random delay to stagger requests if many
            // setTimeout(() => fetchAndCacheImage(id, img), Math.random() * 1000);
            // Just call direct, browser queues them.
            fetchAndCacheImage(id, img);
        }
    }
}

async function fetchAndCacheImage(id, imgElement) {
    const numericId = id.substring(1);
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=Messier_${numericId}&prop=pageimages&format=json&pithumbsize=128&origin=*&redirects=1`;

    try {
        const res = await fetch(apiUrl);
        const data = await res.json();
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        if (pages[pageId].thumbnail) {
            const url = pages[pageId].thumbnail.source;
            imgElement.src = url;
            localStorage.setItem(`messier_img_${id}`, url);
        } else {
            // No image found, maybe hide or set default
            imgElement.style.display = 'none';
        }
    } catch (e) {
        console.warn(`Failed to fetch image for ${id}`, e);
        imgElement.style.display = 'none';
    }
}

function getVisibleObjects(date, loc) {
    const jd = Astronomy.dateToJD(date);
    const lst = Astronomy.calculateLST(jd, loc.lon); // Local Sidereal Time in Degrees
    
    const visible = [];

    messierData.forEach(obj => {
        // Calculate Altitude
        const alt = Astronomy.calculateAltitude(obj.ra, obj.dec, loc.lat, lst);
        
        if (alt >= VISIBILITY_THRESHOLD) {
            visible.push({ ...obj, alt });
        }
    });

    // Sort by altitude or magnitude? Let's sort by Altitude (highest best)
    return visible.sort((a, b) => b.alt - a.alt);
}

// --- Astronomy Math Helper ---
const Astronomy = {
    // Convert Date to Julian Day
    dateToJD: (date) => {
        return (date.getTime() / 86400000) + 2440587.5;
    },

    // Get number of days since J2000.0
    getD: (jd) => {
        return jd - 2451545.0;
    },

    deg2rad: (deg) => deg * (Math.PI / 180),
    rad2deg: (rad) => rad * (180 / Math.PI),

    // Calculate Sun Position (RA/Dec) for a given JD
    // Low precision formulas (approx 1 deg error, sufficient for twilight)
    getSunPosition: (jd) => {
        const D = Astronomy.getD(jd);
        const g = 357.529 + 0.98560028 * D; // Mean anomaly
        const q = 280.459 + 0.98564736 * D; // Mean longitude
        
        const gRad = Astronomy.deg2rad(g % 360);
        const qRad = Astronomy.deg2rad(q % 360);
        
        const L = q + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad); // Ecliptic longitude
        const LRad = Astronomy.deg2rad(L);
        
        const e = 23.439 - 0.00000036 * D; // Obliquity of ecliptic
        const eRad = Astronomy.deg2rad(e);

        const raRad = Math.atan2(Math.cos(eRad) * Math.sin(LRad), Math.cos(LRad));
        const decRad = Math.asin(Math.sin(eRad) * Math.sin(LRad));

        let ra = Astronomy.rad2deg(raRad);
        if (ra < 0) ra += 360;
        
        return {
            ra: ra,
            dec: Astronomy.rad2deg(decRad)
        };
    },

    // Calculate Local Sidereal Time (in degrees)
    calculateLST: (jd, lon) => {
        const D = Astronomy.getD(jd);
        // GMST calculation
        let gmst = 280.46061837 + 360.98564736629 * D;
        gmst = gmst % 360;
        if (gmst < 0) gmst += 360;
        
        // LMST = GMST + Longitude
        let lmst = gmst + lon;
        return lmst % 360;
    },

    // Calculate Altitude of an object
    calculateAltitude: (ra, dec, lat, lst) => {
        // Hour Angle (H) = LST - RA
        let H = lst - ra;
        if (H < 0) H += 360;

        const latRad = Astronomy.deg2rad(lat);
        const decRad = Astronomy.deg2rad(dec);
        const HRad = Astronomy.deg2rad(H);

        const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(HRad);
        const altRad = Math.asin(sinAlt);

        return Astronomy.rad2deg(altRad);
    },

    // Calculate Twilight Times (Morning/Evening)
    getTwilightTimes: (date, lat, lon) => {
        // We need noon JD for the given date to get Sun's Dec approx
        const noon = new Date(date);
        noon.setHours(12, 0, 0, 0);
        const jd = Astronomy.dateToJD(noon);
        const sunPos = Astronomy.getSunPosition(jd);

        // Cos(H) = (Sin(-18) - Sin(Lat)Sin(Dec)) / (Cos(Lat)Cos(Dec))
        const h0 = TWILIGHT_ALTITUDE; // -18
        const latRad = Astronomy.deg2rad(lat);
        const decRad = Astronomy.deg2rad(sunPos.dec);
        const h0Rad = Astronomy.deg2rad(h0);

        const cosH = (Math.sin(h0Rad) - Math.sin(latRad) * Math.sin(decRad)) / (Math.cos(latRad) * Math.cos(decRad));

        if (cosH > 1 || cosH < -1) {
            return { dusk: null, dawn: null }; // Always light or always dark
        }

        const HRad = Math.acos(cosH);
        const HDeg = Astronomy.rad2deg(HRad); // Hour angle in degrees

        // Transit time (approx noon + longitude correction)
        // This is a rough approx. Improved: use Equation of Time?
        // Let's stick to a simpler method: 
        // LST_transit = RA_sun
        // LST = GMST + Lon -> GMST = RA_sun - Lon
        // We can solve for time.
        
        // Alternative: Use 12:00 UTC - Lon/15 + EquationOfTime
        // EqTime approx (minutes) = 4 * (var y = tan(e/2)^2 ...)
        // Let's iterate or simpler: Time = 12h - Lon/15.
        // This gives Local Mean Time of transit.
        
        // Let's assume Transit is at 12:00 local solar time.
        // Correction for timezone is needed if we want wall clock time.
        // JavaScript Dates handle timezone. We just need offset from UTC.
        
        // Simplified Logic:
        // We have H (degrees) duration from transit to twilight.
        // H/15 is hours.
        // Transit happens when Sun is highest. 
        // We need the Time of Transit.
        // Transit Time (UTC) approx = 12:00 - (Longitude / 15) - (EquationOfTime / 60)
        
        // Let's implement Equation of Time for better accuracy (~15 mins error otherwise)
        const D = Astronomy.getD(jd);
        const L = 280.460 + 0.9856474 * D;
        const g = 357.528 + 0.9856003 * D;
        const LRad = Astronomy.deg2rad(L);
        const gRad = Astronomy.deg2rad(g);
        
        // EOT in degrees? No, let's calc RA/Sun again.
        // EqTime = L - RA (roughly)
        
        // Let's use the RA we calculated.
        // GMST at 0h UTC = ...
        // It's getting complex.
        
        // Fallback: Use `SunCalc` logic simplification.
        // Rise/Set is at 12:00 UTC + (TransitOffset) +/- (H/15)
        // Jnoon = 2451545 + 0.0008 + l_w/360 * n ...
        
        // Let's try a direct approach using known approximate transit.
        // Transit ~ 12:00 Local Time (ignoring DST and EOT).
        // Let's refine:
        // UTC Transit = 12 - (Lon / 15) - (EOT_minutes / 60).
        
        // EOT Approx:
        const y = Math.tan(Astronomy.deg2rad(23.439)/2) ** 2;
        const eotRad = y * Math.sin(2*LRad) - 2 * 0.0167 * Math.sin(gRad) + 4 * 0.0167 * y * Math.sin(gRad) * Math.cos(2*LRad) - 0.5 * y * y * Math.sin(4*LRad) - 1.25 * 0.0167 * 0.0167 * Math.sin(2*gRad);
        const eotMinutes = 4 * Astronomy.rad2deg(eotRad);
        
        // Time of transit in UTC hours
        const transitUTC = 12 - (lon / 15) - (eotMinutes / 60);
        const durationHours = HDeg / 15;
        
        const setUTC = transitUTC + durationHours;
        const riseUTC = transitUTC - durationHours; // This is Rise on the SAME day. 
        // For Morning Twilight (Dawn), we usually mean "Next Morning" relative to "Evening Dusk".
        // But for "Tonight", we want Dusk(Today) and Dawn(Tomorrow).
        
        // Create Date objects (UTC)
        // We need to handle day rollover carefully.
        
        const duskDate = new Date(Date.UTC(noon.getFullYear(), noon.getMonth(), noon.getDate(), 0, 0, 0));
        const dawnDate = new Date(Date.UTC(noon.getFullYear(), noon.getMonth(), noon.getDate(), 0, 0, 0));
        
        // Set hours supports fractional? No.
        // Convert fractional hours to ms.
        duskDate.setTime(duskDate.getTime() + setUTC * 3600000);
        
        // Dawn is usually the *next* crossing of -18 deg.
        // riseUTC is roughly the *previous* dawn (morning of today).
        // We want morning of tomorrow. So add 24h?
        // Actually, riseUTC is relative to the transit of *today*.
        // The transit of *tomorrow* is ~24h later.
        // So Dawn(Tomorrow) ~ riseUTC + 24.
        
        dawnDate.setTime(dawnDate.getTime() + (riseUTC + 24) * 3600000);
        
        return { dusk: duskDate, dawn: dawnDate };
    }
};
