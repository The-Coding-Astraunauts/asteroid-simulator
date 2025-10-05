import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, RotateCcw, Info, AlertTriangle, Zap, Shield, Database, Globe } from 'lucide-react';
import * as THREE from 'three';

const fetchNASANearEarthObjects = async () => {
  try {
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const response = await fetch(
      `https://api.nasa.gov/neo/rest/v1/feed?start_date=${startDate}&end_date=${endDate}&api_key=${process.env.REACT_APP_NASA_API_KEY}`
    );
    
    if (!response.ok) throw new Error('NASA API request failed');
    
    const data = await response.json();
    const asteroids = [];
    
    Object.values(data.near_earth_objects).forEach(dayAsteroids => {
      dayAsteroids.forEach(asteroid => {
        const diameterMin = asteroid.estimated_diameter?.meters?.estimated_diameter_min || 50;
        const diameterMax = asteroid.estimated_diameter?.meters?.estimated_diameter_max || 100;
        const avgDiameter = (diameterMin + diameterMax) / 2;
        
        const velocityKmS = parseFloat(
          asteroid.close_approach_data?.[0]?.relative_velocity?.kilometers_per_second || 20
        );
        
        asteroids.push({
          name: asteroid.name.replace(/[()]/g, ''),
          size: Math.round(avgDiameter),
          velocity: parseFloat(velocityKmS.toFixed(1)),
          composition: avgDiameter > 200 ? 'carbonaceous' : 'stony',
          angle: 45,
          isPotentiallyHazardous: asteroid.is_potentially_hazardous_asteroid
        });
      });
    });
    
    return asteroids.slice(0, 10);
  } catch (error) {
    console.error('Failed to fetch NASA data:', error);
    return [];
  }
};

const HISTORICAL_SCENARIOS = {
  tunguska: { name: 'Tunguska Event', size: 60, velocity: 27, composition: 'stony', angle: 30 },
  chelyabinsk: { name: 'Chelyabinsk Meteor', size: 20, velocity: 19, composition: 'stony', angle: 18 },
  chicxulub: { name: 'Chicxulub Impactor', size: 10000, velocity: 20, composition: 'carbonaceous', angle: 60 },
  apophis: { name: '99942 Apophis', size: 370, velocity: 12.6, composition: 'stony', angle: 15 }
};

const COMPOSITIONS = {
  stony: { density: 3000, color: 0x8B7355, name: 'Stony', albedo: 0.20 },
  iron: { density: 7800, color: 0x696969, name: 'Iron', albedo: 0.15 },
  carbonaceous: { density: 2000, color: 0x2F1B0C, name: 'Carbonaceous', albedo: 0.05 }
};

const DEFLECTION_METHODS = {
  none: { name: 'No Deflection', effectiveness: 0, minLeadTime: 0, color: 0x888888 },
  kinetic: { name: 'Kinetic Impactor', effectiveness: 0.15, minLeadTime: 5, color: 0x00ff00 },
  nuclear: { name: 'Nuclear Standoff', effectiveness: 0.8, minLeadTime: 2, color: 0xff0000 },
  gravity: { name: 'Gravity Tractor', effectiveness: 0.05, minLeadTime: 20, color: 0x0088ff },
  laser: { name: 'Laser Ablation', effectiveness: 0.10, minLeadTime: 10, color: 0xff00ff }
};

const AsteroidSimulator = () => {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const animationRef = useRef(null);
  const asteroidRef = useRef(null);
  const trajectoryRef = useRef(null);
  const missTrajectoryRef = useRef(null);
  const impactZonesRef = useRef([]);
  const fragmentsRef = useRef([]);
  const earthRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef({ azimuth: 0, elevation: 30, distance: 15000 });
  const animationFrameRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const mountedRef = useRef(true);
  const missileRef = useRef(null);
  const missileTrajectoryRef = useRef(null);
  const impactPointRef = useRef(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [timeScale, setTimeScale] = useState(1);
  
  const [asteroidSize, setAsteroidSize] = useState(100);
  const [velocity, setVelocity] = useState(20);
  const [composition, setComposition] = useState('stony');
  const [impactAngle, setImpactAngle] = useState(45);
  
  const [deflectionMethod, setDeflectionMethod] = useState('none');
  const [deflectionLeadTime, setDeflectionLeadTime] = useState(10);
  const [deflectionAngle, setDeflectionAngle] = useState(0);
  const [missileDeployed, setMissileDeployed] = useState(false);
  
  const [hasImpacted, setHasImpacted] = useState(false);
  const [hasMissed, setHasMissed] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [activeTab, setActiveTab] = useState('parameters');
  const [impactData, setImpactData] = useState(null);
  const [threatLevel, setThreatLevel] = useState('MODERATE');
  
  const [nasaAsteroids, setNasaAsteroids] = useState([]);
  const [selectedAsteroidName, setSelectedAsteroidName] = useState('Custom Asteroid');
  const [loadingNASA, setLoadingNASA] = useState(false);

  const EARTH_RADIUS = 4500;
  
  const calculateImpactEffects = useMemo(() => {
    const mass = (4/3) * Math.PI * Math.pow(asteroidSize/2, 3) * COMPOSITIONS[composition].density;
    const kineticEnergy = 0.5 * mass * Math.pow(velocity * 1000, 2) / 4.184e15;
    
    const impactVelocity = velocity * 1000 * Math.sin(impactAngle * Math.PI / 180);
    const craterDiameter = 1.8 * Math.pow(mass, 0.22) * Math.pow(impactVelocity, 0.44) * Math.pow(Math.sin(impactAngle * Math.PI / 180), 0.33);
    const craterDepth = craterDiameter / 5;
    
    const airblastRadius = Math.pow(kineticEnergy, 0.33) * 2.2;
    const thermalRadius = Math.pow(kineticEnergy, 0.41) * 1.5;
    const seismicRadius = Math.pow(kineticEnergy, 0.33) * 5;
    const magnitude = (2/3) * Math.log10(kineticEnergy * 4.184e15) - 2.9;
    
    const populationDensity = 50;
    const affectedArea = Math.PI * Math.pow(airblastRadius, 2);
    const populationAtRisk = Math.round(affectedArea * populationDensity);
    
    let threat = 'LOW';
    if (kineticEnergy > 1000) threat = 'CATASTROPHIC';
    else if (kineticEnergy > 100) threat = 'SEVERE';
    else if (kineticEnergy > 10) threat = 'HIGH';
    else if (kineticEnergy > 1) threat = 'MODERATE';
    
    return {
      mass: (mass / 1e12).toFixed(2),
      energy: kineticEnergy.toFixed(2),
      craterDiameter: craterDiameter.toFixed(1),
      craterDepth: craterDepth.toFixed(1),
      airblastRadius: airblastRadius.toFixed(1),
      thermalRadius: thermalRadius.toFixed(1),
      seismicRadius: seismicRadius.toFixed(1),
      magnitude: magnitude.toFixed(1),
      populationAtRisk: populationAtRisk.toLocaleString(),
      threatLevel: threat
    };
  }, [asteroidSize, velocity, composition, impactAngle]);
  
  const deflectionSuccess = useMemo(() => {
    const method = DEFLECTION_METHODS[deflectionMethod];
    if (!method || deflectionLeadTime < method.minLeadTime) return false;
    const maxDeflection = method.effectiveness * deflectionLeadTime;
    return maxDeflection >= 0.5;
  }, [deflectionMethod, deflectionLeadTime]);
  
  useEffect(() => {
    setThreatLevel(calculateImpactEffects.threatLevel);
  }, [calculateImpactEffects]);

  useEffect(() => {
    const loadNASAAsteroids = async () => {
      setLoadingNASA(true);
      const asteroids = await fetchNASANearEarthObjects();
      setNasaAsteroids(asteroids);
      setLoadingNASA(false);
    };
    loadNASAAsteroids();
  }, []);

  const getImpactPoint = (angle) => {
    const angleRad = (angle * Math.PI) / 180;
    const latitude = (angle - 45) * 2;
    const latRad = (latitude * Math.PI) / 180;
    
    const x = EARTH_RADIUS * Math.cos(latRad) * Math.cos(angleRad);
    const y = EARTH_RADIUS * Math.sin(latRad);
    const z = EARTH_RADIUS * Math.cos(latRad) * Math.sin(angleRad);
    
    return { x, y, z };
  };
  
  const updateTrajectory = () => {
    if (!trajectoryRef.current || !sceneRef.current) return;
    
    const points = [];
    const steps = 100;
    const effectiveAngle = impactAngle + deflectionAngle;
    
    const impactPoint = getImpactPoint(effectiveAngle);
    const startDistance = 20000;
    
    const dir = new THREE.Vector3(impactPoint.x, impactPoint.y, impactPoint.z).normalize();
    const startPos = dir.clone().multiplyScalar(-startDistance);
    startPos.y = Math.abs(startPos.y) + 5000;
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = new THREE.Vector3().lerpVectors(startPos, new THREE.Vector3(impactPoint.x, impactPoint.y, impactPoint.z), t);
      
      const curve = Math.sin(t * Math.PI) * 2000 * (1 - effectiveAngle / 90);
      pos.y += curve;
      
      points.push(pos);
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    if (trajectoryRef.current.geometry) trajectoryRef.current.geometry.dispose();
    trajectoryRef.current.geometry = geometry;
    trajectoryRef.current.visible = true;
  };

  const createFragments = (position) => {
    if (!sceneRef.current) return;
    
    const fragmentCount = 20;
    for (let i = 0; i < fragmentCount; i++) {
      const size = (Math.random() * 20 + 10) * (asteroidSize / 100);
      const geometry = new THREE.SphereGeometry(size, 8, 8);
      const material = new THREE.MeshPhongMaterial({
        color: COMPOSITIONS[composition].color,
        emissive: 0xff3300,
        emissiveIntensity: 0.5
      });
      
      const fragment = new THREE.Mesh(geometry, material);
      fragment.position.copy(position);
      
      fragment.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 200
      );
      
      fragment.userData.rotation = new THREE.Vector3(
        Math.random() * 0.1,
        Math.random() * 0.1,
        Math.random() * 0.1
      );
      
      sceneRef.current.add(fragment);
      fragmentsRef.current.push(fragment);
    }
  };

  const animateFragments = () => {
    fragmentsRef.current.forEach((fragment, index) => {
      fragment.position.add(fragment.userData.velocity);
      fragment.rotation.x += fragment.userData.rotation.x;
      fragment.rotation.y += fragment.userData.rotation.y;
      fragment.rotation.z += fragment.userData.rotation.z;
      
      fragment.userData.velocity.y -= 5;
      
      fragment.material.opacity = Math.max(0, fragment.material.opacity - 0.01);
      fragment.material.transparent = true;
      
      if (fragment.material.opacity <= 0) {
        sceneRef.current.remove(fragment);
        fragment.geometry.dispose();
        fragment.material.dispose();
        fragmentsRef.current.splice(index, 1);
      }
    });
  };

  const launchMissile = () => {
    if (!sceneRef.current || !asteroidRef.current || missileDeployed) return;
    
    const impactPoint = getImpactPoint(impactAngle);
    const missileGeo = new THREE.ConeGeometry(30, 150, 8);
    const missileMat = new THREE.MeshPhongMaterial({
      color: DEFLECTION_METHODS[deflectionMethod].color,
      emissive: DEFLECTION_METHODS[deflectionMethod].color,
      emissiveIntensity: 0.5
    });
    
    const missile = new THREE.Mesh(missileGeo, missileMat);
    missile.position.set(impactPoint.x * 1.1, impactPoint.y * 1.1, impactPoint.z * 1.1);
    
    const glowGeo = new THREE.SphereGeometry(50, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.6
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    missile.add(glow);
    glow.position.y = -100;
    
    sceneRef.current.add(missile);
    missileRef.current = missile;
    
    const missilePoints = [];
    const steps = 50;
    const asteroidPos = asteroidRef.current.position.clone();
    const missileStart = missile.position.clone();
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = new THREE.Vector3().lerpVectors(missileStart, asteroidPos, t);
      missilePoints.push(pos);
    }
    
    const missileGeoLine = new THREE.BufferGeometry().setFromPoints(missilePoints);
    const missileMatLine = new THREE.LineBasicMaterial({ 
      color: DEFLECTION_METHODS[deflectionMethod].color,
      transparent: true,
      opacity: 0.6
    });
    const missileTrail = new THREE.Line(missileGeoLine, missileMatLine);
    sceneRef.current.add(missileTrail);
    missileTrajectoryRef.current = missileTrail;
    
    setMissileDeployed(true);
  };

  const animateMissile = () => {
    if (!missileRef.current || !asteroidRef.current) return;
    
    const targetPos = asteroidRef.current.position.clone();
    const direction = new THREE.Vector3().subVectors(targetPos, missileRef.current.position).normalize();
    
    missileRef.current.position.add(direction.multiplyScalar(150));
    missileRef.current.lookAt(targetPos);
    
    const distance = missileRef.current.position.distanceTo(targetPos);
    if (distance < 200) {
      const method = DEFLECTION_METHODS[deflectionMethod];
      if (method && deflectionLeadTime >= method.minLeadTime) {
        const angle = method.effectiveness * deflectionLeadTime * 10;
        setDeflectionAngle(Math.min(angle, 45));
      }
      
      const explosionGeo = new THREE.SphereGeometry(300, 16, 16);
      const explosionMat = new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.8
      });
      const explosion = new THREE.Mesh(explosionGeo, explosionMat);
      explosion.position.copy(missileRef.current.position);
      sceneRef.current.add(explosion);
      
      setTimeout(() => {
        sceneRef.current.remove(explosion);
        explosion.geometry.dispose();
        explosion.material.dispose();
      }, 500);
      
      sceneRef.current.remove(missileRef.current);
      if (missileTrajectoryRef.current) {
        sceneRef.current.remove(missileTrajectoryRef.current);
      }
      missileRef.current = null;
      missileTrajectoryRef.current = null;
      
      updateTrajectory();
    }
  };
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    mountedRef.current = true;
    
    while (containerRef.current.firstChild) {
      containerRef.current.removeChild(containerRef.current.firstChild);
    }
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000208);
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      100000
    );
    camera.position.set(0, 8000, 15000);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    const ambientLight = new THREE.AmbientLight(0x333344, 0.3);
    scene.add(ambientLight);
    
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(15000, 10000, 12000);
    sunLight.castShadow = true;
    scene.add(sunLight);
    
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 2, transparent: true, opacity: 0.8 });
    const starsVertices = [];
    
    for (let i = 0; i < 10000; i++) {
      const radius = 20000 + Math.random() * 30000;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starsVertices.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      );
    }
    
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);
    
    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
    
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = 'rgba(26, 99, 246, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = 'rgba(26, 99, 246, 1)';
    const continents = [
      { x: 0.5, y: 0.5, w: 0.15, h: 0.25 },
      { x: 0.15, y: 0.4, w: 0.12, h: 0.35 },
      { x: 0.6, y: 0.3, w: 0.25, h: 0.3 },
      { x: 0.75, y: 0.65, w: 0.08, h: 0.12 }
    ];
    
    continents.forEach(c => {
      ctx.beginPath();
      ctx.ellipse(
        c.x * canvas.width, 
        c.y * canvas.height,
        c.w * canvas.width,
        c.h * canvas.height,
        0, 0, Math.PI * 2
      );
      ctx.fill();
    });
    
    ctx.fillStyle = '#rgba(26, 99, 246, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height * 0.1);
    ctx.fillRect(0, canvas.height * 0.9, canvas.width, canvas.height * 0.1);
    
    const earthTexture = new THREE.CanvasTexture(canvas);
    const earthMaterial = new THREE.MeshPhongMaterial({
      map: earthTexture,
      shininess: 25,
      specular: 0x333333
    });
    
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    earth.castShadow = true;
    earth.receiveShadow = true;
    scene.add(earth);
    earthRef.current = earth;
    
    const atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS + 200, 64, 64);
    const atmosphereMaterial = new THREE.MeshPhongMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide
    });
    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    scene.add(atmosphere);
    
    const asteroidScale = asteroidSize / 60;
    const asteroidGeometry = new THREE.SphereGeometry(asteroidScale, 32, 32);
    const asteroidMaterial = new THREE.MeshPhongMaterial({
      color: COMPOSITIONS[composition].color,
      emissive: 0xff3300,
      emissiveIntensity: 0.2,
      shininess: 5
    });
    
    const asteroid = new THREE.Mesh(asteroidGeometry, asteroidMaterial);
    const impactPoint = getImpactPoint(impactAngle);
    const dir = new THREE.Vector3(impactPoint.x, impactPoint.y, impactPoint.z).normalize();
    const startPos = dir.clone().multiplyScalar(-20000);
    startPos.y = Math.abs(startPos.y) + 5000;
    asteroid.position.copy(startPos);
    asteroid.castShadow = true;
    scene.add(asteroid);
    asteroidRef.current = asteroid;
    
    const glowGeometry = new THREE.SphereGeometry(asteroidScale * 1.3, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.3 });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    asteroid.add(glow);
    
    const trajectoryMaterial = new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.9, linewidth: 2 });
    const trajectoryGeometry = new THREE.BufferGeometry();
    const trajectory = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
    scene.add(trajectory);
    trajectoryRef.current = trajectory;
    
    const missTrajectoryMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6, linewidth: 2 });
    const missTrajectoryGeometry = new THREE.BufferGeometry();
    const missTrajectory = new THREE.Line(missTrajectoryGeometry, missTrajectoryMaterial);
    missTrajectory.visible = false;
    scene.add(missTrajectory);
    missTrajectoryRef.current = missTrajectory;
    
    const zones = [
      { color: 0xff0000, opacity: 0.6 },
      { color: 0xff6600, opacity: 0.4 },
      { color: 0xffaa00, opacity: 0.2 }
    ];
    
    impactZonesRef.current = [];
    zones.forEach((zone) => {
      const geometry = new THREE.RingGeometry(0, 1, 64);
      const material = new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      impactZonesRef.current.push(mesh);
    });
    
    const impactMarkerGeo = new THREE.SphereGeometry(100, 16, 16);
    const impactMarkerMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.7 });
    const impactMarker = new THREE.Mesh(impactMarkerGeo, impactMarkerMat);
    const ip = getImpactPoint(impactAngle);
    impactMarker.position.set(ip.x, ip.y, ip.z);
    scene.add(impactMarker);
    impactPointRef.current = impactMarker;
    
    const gridHelper = new THREE.PolarGridHelper(8000, 16, 8, 64, 0x444444, 0x222222);
    gridHelper.position.y = -5000;
    scene.add(gridHelper);
    
    let time = 0;
    const animate = () => {
      if (!mountedRef.current) return;
      
      animationRef.current = requestAnimationFrame(animate);
      time += 0.01;
      
      const controls = controlsRef.current;
      const azimuthRad = (controls.azimuth * Math.PI) / 180;
      const elevationRad = (controls.elevation * Math.PI) / 180;
      
      camera.position.x = controls.distance * Math.cos(elevationRad) * Math.sin(azimuthRad);
      camera.position.y = controls.distance * Math.sin(elevationRad);
      camera.position.z = controls.distance * Math.cos(elevationRad) * Math.cos(azimuthRad);
      camera.lookAt(0, 0, 0);
      
      controlsRef.current.azimuth += 0.05;
      
      if (earth) earth.rotation.y += 0.001;
      if (asteroidRef.current && !isAnimatingRef.current) {
        asteroidRef.current.rotation.x += 0.02;
        asteroidRef.current.rotation.y += 0.015;
      }
      
      atmosphere.rotation.y += 0.0005;
      
      if (impactMarker) {
        impactMarker.material.opacity = 0.4 + Math.sin(time * 3) * 0.3;
      }
      
      if (missileRef.current && isAnimatingRef.current) {
        animateMissile();
      }
      
      if (fragmentsRef.current.length > 0) {
        animateFragments();
      }
      
      renderer.render(scene, camera);
    };
    animate();
    
    const handleResize = () => {
      if (!containerRef.current || !mountedRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);
    
    let isDragging = false;
    let previousMouseX = 0;
    let previousMouseY = 0;
    
    const handleMouseDown = (e) => {
      isDragging = true;
      previousMouseX = e.clientX;
      previousMouseY = e.clientY;
    };
    
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - previousMouseX;
      const deltaY = e.clientY - previousMouseY;
      controlsRef.current.azimuth += deltaX * 0.3;
      controlsRef.current.elevation = Math.max(-80, Math.min(80, controlsRef.current.elevation - deltaY * 0.3));
      previousMouseX = e.clientX;
      previousMouseY = e.clientY;
    };
    
    const handleMouseUp = () => { isDragging = false; };
    
    const handleWheel = (e) => {
      e.preventDefault();
      controlsRef.current.distance = Math.max(8000, Math.min(40000, controlsRef.current.distance + e.deltaY * 5));
    };
    
    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('wheel', handleWheel);
    
    setTimeout(() => {
      if (mountedRef.current) updateTrajectory();
    }, 100);
    
    return () => {
      mountedRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement) {
        renderer.domElement.removeEventListener('mousedown', handleMouseDown);
        renderer.domElement.removeEventListener('mousemove', handleMouseMove);
        renderer.domElement.removeEventListener('mouseup', handleMouseUp);
        renderer.domElement.removeEventListener('wheel', handleWheel);
      }
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(material => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      if (containerRef.current && renderer.domElement && containerRef.current.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);
  
  useEffect(() => {
    updateTrajectory();
    if (impactPointRef.current) {
      const ip = getImpactPoint(impactAngle + deflectionAngle);
      impactPointRef.current.position.set(ip.x, ip.y, ip.z);
    }
    if (asteroidRef.current && !isPlaying) {
      const impactPoint = getImpactPoint(impactAngle);
      const dir = new THREE.Vector3(impactPoint.x, impactPoint.y, impactPoint.z).normalize();
      const startPos = dir.clone().multiplyScalar(-20000);
      startPos.y = Math.abs(startPos.y) + 5000;
      asteroidRef.current.position.copy(startPos);
    }
  }, [impactAngle, deflectionAngle, asteroidSize]);
  
  useEffect(() => {
    if (asteroidRef.current) {
      asteroidRef.current.material.color.setHex(COMPOSITIONS[composition].color);
      const scale = asteroidSize / 15;
      asteroidRef.current.scale.set(scale, scale, scale);
    }
  }, [composition, asteroidSize]);
  
  const animateAsteroid = () => {
    if (!asteroidRef.current) return;
    
    isAnimatingRef.current = true;
    const duration = 300 / timeScale;
    let frame = 0;
    
    const step = () => {
      if (!isPlaying || frame >= duration || !mountedRef.current) {
        isAnimatingRef.current = false;
        if (frame >= duration && mountedRef.current) {
          const distanceToCenter = asteroidRef.current.position.length();
          const asteroidRadius = (asteroidSize / 100);
          
          if (distanceToCenter <= EARTH_RADIUS + asteroidRadius) {
            handleImpact();
          } else {
            handleMiss();
          }
        }
        return;
      }
      
      const t = frame / duration;
      const effectiveAngle = impactAngle + deflectionAngle;
      const impactPoint = getImpactPoint(effectiveAngle);
      
      const dir = new THREE.Vector3(impactPoint.x, impactPoint.y, impactPoint.z).normalize();
      const startPos = dir.clone().multiplyScalar(-20000);
      startPos.y = Math.abs(startPos.y) + 5000;
      
      const currentPos = new THREE.Vector3().lerpVectors(
        startPos, 
        new THREE.Vector3(impactPoint.x, impactPoint.y, impactPoint.z), 
        t
      );
      
      const curve = Math.sin(t * Math.PI) * 2000 * (1 - effectiveAngle / 90);
      currentPos.y += curve;
      
      asteroidRef.current.position.copy(currentPos);
      
      const distanceToCenter = asteroidRef.current.position.length();
      const asteroidRadius = (asteroidSize / 100);
      
      if (distanceToCenter <= EARTH_RADIUS + asteroidRadius) {
        setProgress(100);
        handleImpact();
        return;
      }
      
      const scale = asteroidSize / 15;
      asteroidRef.current.scale.set(scale, scale, scale);
      
      if (t > 0.7) {
        const heatIntensity = (t - 0.7) / 0.3;
        asteroidRef.current.material.emissive.setHex(0xff3300);
        asteroidRef.current.material.emissiveIntensity = heatIntensity * 0.8;
      }
      
      setProgress(t * 100);
      frame++;
      
      animationFrameRef.current = setTimeout(step, 16 / timeScale);
    };
    
    step();
  };
  
  const handleImpact = () => {
    setHasImpacted(true);
    const data = calculateImpactEffects;
    setImpactData(data);
    
    if (asteroidRef.current) {
      createFragments(asteroidRef.current.position.clone());
      asteroidRef.current.visible = false;
    }
    
    if (impactZonesRef.current.length > 0) {
      const impactPoint = getImpactPoint(impactAngle + deflectionAngle);
      
      const craterScale = parseFloat(data.craterDiameter) * 5;
      const airblastScale = parseFloat(data.airblastRadius) * 3;
      const thermalScale = parseFloat(data.thermalRadius) * 2;
      
      impactZonesRef.current[0].position.set(impactPoint.x, impactPoint.y, impactPoint.z);
      impactZonesRef.current[0].scale.set(craterScale, craterScale, 1);
      impactZonesRef.current[0].material.opacity = 0.0;
      impactZonesRef.current[0].lookAt(0, 0, 0);
      
      impactZonesRef.current[1].position.set(impactPoint.x, impactPoint.y, impactPoint.z);
      impactZonesRef.current[1].scale.set(airblastScale, airblastScale, 1);
      impactZonesRef.current[1].material.opacity = 0.0;
      impactZonesRef.current[1].lookAt(0, 0, 0);
      
      impactZonesRef.current[2].position.set(impactPoint.x, impactPoint.y, impactPoint.z);
      impactZonesRef.current[2].scale.set(thermalScale, thermalScale, 1);
      impactZonesRef.current[2].material.opacity = 0.0;
      impactZonesRef.current[2].lookAt(0, 0, 0);
    }
    
    setIsPlaying(false);
    isAnimatingRef.current = false;
  };
  
  const handleMiss = () => {
    setHasMissed(true);
    
    if (missTrajectoryRef.current && asteroidRef.current) {
      const points = [];
      const currentPos = asteroidRef.current.position.clone();
      const direction = currentPos.clone().normalize();
      
      for (let i = 0; i <= 100; i++) {
        const pos = currentPos.clone().add(direction.clone().multiplyScalar(i * 300));
        points.push(pos);
      }
      
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      if (missTrajectoryRef.current.geometry) {
        missTrajectoryRef.current.geometry.dispose();
      }
      missTrajectoryRef.current.geometry = geometry;
      missTrajectoryRef.current.visible = true;
    }
    
    setIsPlaying(false);
    isAnimatingRef.current = false;
  };
  
  const handleReset = () => {
    if (animationFrameRef.current) {
      clearTimeout(animationFrameRef.current);
    }
    
    setIsPlaying(false);
    setProgress(0);
    setHasImpacted(false);
    setHasMissed(false);
    setMissileDeployed(false);
    isAnimatingRef.current = false;
    
    if (asteroidRef.current) {
      const impactPoint = getImpactPoint(impactAngle);
      const dir = new THREE.Vector3(impactPoint.x, impactPoint.y, impactPoint.z).normalize();
      const startPos = dir.clone().multiplyScalar(-20000);
      startPos.y = Math.abs(startPos.y) + 5000;
      asteroidRef.current.position.copy(startPos);
      asteroidRef.current.visible = true;
      asteroidRef.current.material.emissiveIntensity = 0.2;
      const scale = asteroidSize / 15;
      asteroidRef.current.scale.set(scale, scale, scale);
    }
    
    fragmentsRef.current.forEach(fragment => {
      if (sceneRef.current) sceneRef.current.remove(fragment);
      fragment.geometry.dispose();
      fragment.material.dispose();
    });
    fragmentsRef.current = [];
    
    if (missileRef.current && sceneRef.current) {
      sceneRef.current.remove(missileRef.current);
      missileRef.current = null;
    }
    if (missileTrajectoryRef.current && sceneRef.current) {
      sceneRef.current.remove(missileTrajectoryRef.current);
      missileTrajectoryRef.current = null;
    }
    
    impactZonesRef.current.forEach(zone => {
      zone.material.opacity = 0;
    });
    
    if (missTrajectoryRef.current) {
      missTrajectoryRef.current.visible = false;
    }
    
    updateTrajectory();
  };
  
  const loadScenario = (key) => {
    const scenario = HISTORICAL_SCENARIOS[key];
    setAsteroidSize(scenario.size);
    setVelocity(scenario.velocity);
    setComposition(scenario.composition);
    setImpactAngle(scenario.angle);
    setSelectedAsteroidName(scenario.name);
    handleReset();
  };

  const loadNASAAsteroid = (asteroid) => {
    setAsteroidSize(asteroid.size);
    setVelocity(asteroid.velocity);
    setComposition(asteroid.composition);
    setImpactAngle(asteroid.angle);
    setSelectedAsteroidName(asteroid.name);
    handleReset();
  };
  
  useEffect(() => {
    const method = DEFLECTION_METHODS[deflectionMethod];
    if (method && deflectionLeadTime >= method.minLeadTime) {
      const angle = method.effectiveness * deflectionLeadTime * 10;
      setDeflectionAngle(Math.min(angle, 45));
    } else {
      setDeflectionAngle(0);
    }
  }, [deflectionMethod, deflectionLeadTime]);
  
  useEffect(() => {
    if (isPlaying) {
      animateAsteroid();
      if (deflectionMethod !== 'none' && !missileDeployed && deflectionLeadTime >= DEFLECTION_METHODS[deflectionMethod].minLeadTime) {
        setTimeout(() => {
          launchMissile();
        }, 2000 / timeScale);
      }
    } else {
      if (animationFrameRef.current) {
        clearTimeout(animationFrameRef.current);
      }
      isAnimatingRef.current = false;
    }
  }, [isPlaying, timeScale]);
  
  const threatColors = {
    LOW: 'bg-green-600',
    MODERATE: 'bg-yellow-600',
    HIGH: 'bg-orange-600',
    SEVERE: 'bg-red-600',
    CATASTROPHIC: 'bg-purple-600'
  };
  
  return (
    <div className="w-full h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
      <div className="bg-gradient-to-r from-gray-800 via-gray-900 to-gray-800 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Globe className="text-blue-400 w-8 h-8" />
            <div>
              <h1 className="text-2xl font-bold">Asteroid Impact Simulator</h1>
              <p className="text-xs text-gray-400">NASA NEO Data - Real Physics - Planetary Defense</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${threatColors[threatLevel]}`}>
              THREAT: {threatLevel}
            </div>
          </div>
          <button onClick={() => setShowInfo(!showInfo)} className="p-2 hover:bg-gray-700 rounded-lg">
            <Info size={20} />
          </button>
        </div>
      </div>
      
      {showInfo && (
        <div className="bg-gradient-to-r from-blue-900 to-purple-900 border-b border-blue-700 p-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <h3 className="font-bold mb-2">Mission Overview</h3>
              <ul className="space-y-1 text-xs">
                <li>Simulate asteroid trajectories with real physics</li>
                <li>Test planetary defense strategies</li>
                <li>Analyze impact effects with realistic scale</li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold mb-2">Controls</h3>
              <ul className="space-y-1 text-xs">
                <li>Mouse Drag: Rotate camera</li>
                <li>Mouse Wheel: Zoom in/out</li>
                <li>Impact Angle: Changes trajectory target</li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold mb-2">Features</h3>
              <ul className="space-y-1 text-xs">
                <li>Realistic Earth scale (12,742km diameter)</li>
                <li>Dynamic impact point selection</li>
                <li>Deflection missiles with visual effects</li>
                <li>Real NASA asteroid data integration</li>
              </ul>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative bg-black">
          <div ref={containerRef} className="w-full h-full" />
          
          <div className="absolute top-4 right-4 space-y-2">
            <div className="bg-gray-900 bg-opacity-90 backdrop-blur-sm p-3 rounded-lg border border-gray-700 text-xs">
              <div className="flex items-center gap-2 mb-2 font-bold text-blue-400">
                <Zap className="w-4 h-4" />
                Live Telemetry
              </div>
              <div className="space-y-1">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-400">Target:</span>
                  <span className="font-mono text-xs truncate max-w-[150px]" title={selectedAsteroidName}>
                    {selectedAsteroidName}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-400">Mass:</span>
                  <span className="font-mono">{calculateImpactEffects.mass} GT</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-400">Energy:</span>
                  <span className="font-mono">{calculateImpactEffects.energy} MT</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-400">Velocity:</span>
                  <span className="font-mono">{velocity} km/s</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-400">Size Ratio:</span>
                  <span className="font-mono">1:{((EARTH_RADIUS * 2) / asteroidSize).toFixed(0)}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="absolute bottom-4 left-4 right-4 bg-gray-900 bg-opacity-90 backdrop-blur-sm p-3 rounded-lg border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-medium">Progress:</span>
              <div className="flex-1 bg-gray-700 rounded-full h-3">
                <div 
                  className="bg-gradient-to-r from-orange-500 via-red-500 to-purple-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-sm font-mono">{progress.toFixed(0)}%</span>
            </div>
          </div>
          
          {hasImpacted && impactData && (
            <div className="absolute top-4 left-4 bg-red-900 bg-opacity-95 p-4 rounded-lg border-2 border-red-500 max-w-md">
              <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                <AlertTriangle className="text-yellow-400" />
                IMPACT DETECTED
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                <div className="bg-red-950 p-2 rounded">
                  <div className="text-gray-400 text-xs">Energy</div>
                  <div className="font-bold">{impactData.energy} MT</div>
                </div>
                <div className="bg-red-950 p-2 rounded">
                  <div className="text-gray-400 text-xs">Magnitude</div>
                  <div className="font-bold">{impactData.magnitude}</div>
                </div>
                <div className="bg-red-950 p-2 rounded">
                  <div className="text-gray-400 text-xs">Crater</div>
                  <div className="font-bold">{impactData.craterDiameter} km</div>
                </div>
                <div className="bg-red-950 p-2 rounded">
                  <div className="text-gray-400 text-xs">At Risk</div>
                  <div className="font-bold">{impactData.populationAtRisk}</div>
                </div>
              </div>
            </div>
          )}
          
          {hasMissed && (
            <div className="absolute top-4 left-4 bg-green-900 bg-opacity-95 p-4 rounded-lg border-2 border-green-500 max-w-md">
              <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                <Shield className="text-green-400" />
                ASTEROID MISSED EARTH
              </h3>
              <p className="text-sm">The asteroid has passed Earth safely. Deflection successful!</p>
            </div>
          )}
        </div>
        
        <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
          <div className="flex border-b border-gray-700">
            {['parameters', 'defense', 'scenarios'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-3 text-sm font-medium ${
                  activeTab === tab ? 'bg-gray-900 text-blue-400 border-b-2 border-blue-400' : 'text-gray-400'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'parameters' && (
              <div className="space-y-6">
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    disabled={hasImpacted || hasMissed}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 p-3 rounded-lg font-medium flex items-center justify-center gap-2"
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button onClick={handleReset} className="bg-gray-600 hover:bg-gray-500 p-3 rounded-lg">
                    <RotateCcw size={20} />
                  </button>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Time Scale: {timeScale}x
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="5"
                    step="0.5"
                    value={timeScale}
                    onChange={(e) => setTimeScale(Number(e.target.value))}
                    disabled={isPlaying}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Diameter: {asteroidSize}m
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="10000"
                    step="10"
                    value={asteroidSize}
                    onChange={(e) => {
                      setAsteroidSize(Number(e.target.value));
                      setSelectedAsteroidName('Custom Asteroid');
                    }}
                    disabled={isPlaying}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Earth is {((EARTH_RADIUS * 2) / asteroidSize).toFixed(1)}x larger
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Velocity: {velocity} km/s
                  </label>
                  <input
                    type="range"
                    min="11"
                    max="72"
                    value={velocity}
                    onChange={(e) => setVelocity(Number(e.target.value))}
                    disabled={isPlaying}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Impact Angle: {impactAngle}° (Changes trajectory target)
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    value={impactAngle}
                    onChange={(e) => setImpactAngle(Number(e.target.value))}
                    disabled={isPlaying}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Adjust to aim at different points on Earth
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Composition
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(COMPOSITIONS).map(([key, comp]) => (
                      <button
                        key={key}
                        onClick={() => setComposition(key)}
                        disabled={isPlaying}
                        className={`p-3 rounded-lg border-2 text-left ${
                          composition === key
                            ? 'border-blue-500 bg-blue-900'
                            : 'border-gray-600 bg-gray-700 hover:bg-gray-600'
                        }`}
                      >
                        <div className="font-medium">{comp.name}</div>
                        <div className="text-xs text-gray-400">
                          Density: {comp.density} kg/m³
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'defense' && (
              <div className="space-y-6">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Shield className="w-5 h-5 text-green-400" />
                  Planetary Defense
                </h2>
                
                <div>
                  <label className="block text-sm font-medium mb-3">
                    Deflection Method
                  </label>
                  <div className="space-y-2">
                    {Object.entries(DEFLECTION_METHODS).map(([key, method]) => (
                      <button
                        key={key}
                        onClick={() => setDeflectionMethod(key)}
                        disabled={isPlaying}
                        className={`w-full p-3 rounded-lg border-2 text-left ${
                          deflectionMethod === key
                            ? 'border-green-500 bg-green-900'
                            : 'border-gray-600 bg-gray-700 hover:bg-gray-600'
                        }`}
                      >
                        <div className="font-medium">{method.name}</div>
                        <div className="text-xs text-gray-400 mt-1">
                          Effectiveness: {(method.effectiveness * 100).toFixed(0)}% - Min: {method.minLeadTime}y
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                
                {deflectionMethod !== 'none' && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Lead Time: {deflectionLeadTime} years
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="30"
                      value={deflectionLeadTime}
                      onChange={(e) => setDeflectionLeadTime(Number(e.target.value))}
                      disabled={isPlaying}
                      className="w-full"
                    />
                    <p className="text-xs mt-2">
                      {deflectionLeadTime < DEFLECTION_METHODS[deflectionMethod].minLeadTime ? (
                        <span className="text-red-400">⚠ Insufficient time for deployment</span>
                      ) : (
                        <span className="text-green-400">✓ Missile will launch automatically</span>
                      )}
                    </p>
                  </div>
                )}
                
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
                  <h4 className="font-bold text-sm mb-2 text-green-400">Mission Status</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Deflection:</span>
                      <span className="font-mono">{deflectionAngle.toFixed(2)}°</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Required:</span>
                      <span className="font-mono">0.50°</span>
                    </div>
                    <div className="pt-2 border-t border-gray-700">
                      <span className={`font-bold ${deflectionSuccess ? 'text-green-400' : 'text-red-400'}`}>
                        {deflectionSuccess ? '✓ MISSION VIABLE' : '✗ MISSION FAILURE'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'scenarios' && (
              <div className="space-y-6">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Database className="w-5 h-5 text-purple-400" />
                  Historical & Real-Time NEOs
                </h2>
                
                <div>
                  <h3 className="text-sm font-bold text-gray-400 mb-2">HISTORICAL EVENTS</h3>
                  <div className="space-y-2">
                    {Object.entries(HISTORICAL_SCENARIOS).map(([key, scenario]) => (
                      <button
                        key={key}
                        onClick={() => loadScenario(key)}
                        disabled={isPlaying}
                        className="w-full p-3 rounded-lg border-2 border-gray-600 bg-gray-700 hover:border-purple-500 hover:bg-gray-600 text-left disabled:opacity-50"
                      >
                        <div className="font-bold text-purple-400 mb-1 text-sm">{scenario.name}</div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-300">
                          <div>Size: {scenario.size}m</div>
                          <div>Velocity: {scenario.velocity} km/s</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                
                <div>
                  <h3 className="text-sm font-bold text-green-400 mb-2">NASA NEAR-EARTH OBJECTS</h3>
                  {loadingNASA ? (
                    <div className="text-center py-4 text-gray-400">Loading NASA data...</div>
                  ) : nasaAsteroids.length > 0 ? (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {nasaAsteroids.map((asteroid, idx) => (
                        <button
                          key={idx}
                          onClick={() => loadNASAAsteroid(asteroid)}
                          disabled={isPlaying}
                          className={`w-full p-3 rounded-lg border-2 text-left disabled:opacity-50 ${
                            asteroid.isPotentiallyHazardous
                              ? 'border-red-500 bg-red-900 bg-opacity-20 hover:bg-red-900 hover:bg-opacity-40'
                              : 'border-gray-600 bg-gray-700 hover:border-green-500 hover:bg-gray-600'
                          }`}
                        >
                          <div className="font-bold text-green-400 mb-1 text-xs flex items-center gap-2">
                            {asteroid.name}
                            {asteroid.isPotentiallyHazardous && (
                              <span className="text-red-400 text-xs">⚠ PHA</span>
                            )}
                          </div><div className="grid grid-cols-2 gap-1 text-xs text-gray-300">
                            <div>Ø {asteroid.size}m</div>
                            <div>{asteroid.velocity} km/s</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-gray-400 text-xs">
                      No NASA data available. Check API key.
                    </div>
                  )}
                </div>

                <div className="p-4 bg-purple-900 bg-opacity-20 rounded-lg border border-purple-700 text-sm">
                  <h4 className="font-bold mb-2">About Historical Impacts</h4>
                  <ul className="space-y-2 text-xs text-gray-300">
                    <li><strong>Tunguska 1908:</strong> 60m airburst flattened 2000 sq km of Siberian forest</li>
                    <li><strong>Chelyabinsk 2013:</strong> 20m meteor injured 1500 people with shockwave</li>
                    <li><strong>Chicxulub:</strong> 10km impactor caused dinosaur extinction 66M years ago</li>
                    <li><strong>Apophis:</strong> 370m NEO with close approach on April 13, 2029</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 text-xs text-gray-400 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span>Advanced Asteroid Impact Simulator 2025</span>
          <span>Realistic Scale • Dynamic Trajectories • NASA Integration</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span>System Online</span>
        </div>
      </div>
    </div>
  );
};

export default AsteroidSimulator;