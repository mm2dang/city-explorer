const confetti = () => {
  const colors = [
    '#0891b2', // Primary teal
    '#14b8a6', // Secondary teal
    '#06b6d4', // Cyan
    '#ffffff', // White
    '#e0f2fe', // Light blue
    '#ccfbf1', // Light teal
  ];

  const confettiCount = 200;
  const container = document.body;
  const duration = 3000;

  class ConfettiParticle {
    constructor(index) {
      this.element = document.createElement('div');
      this.element.style.position = 'fixed';
      this.element.style.pointerEvents = 'none';
      this.element.style.zIndex = '9999';
      
      this.x = Math.random() * window.innerWidth;
      this.y = -30;
      
      this.size = Math.random() * 6 + 6;
      
      this.vx = (Math.random() - 0.5) * 3;
      this.vy = Math.random() * 2 + 4;
      
      // Rotation
      this.rotation = Math.random() * 360;
      this.rotationSpeed = (Math.random() - 0.5) * 20;
      
      // Color
      this.color = colors[Math.floor(Math.random() * colors.length)];
      
      // Shape
      this.shape = Math.random();
      
      // Physics properties
      this.gravity = 0.3 + Math.random() * 0.2;
      this.drag = 0.98;
      this.wobblePhase = Math.random() * Math.PI * 2;
      this.wobbleSpeed = 0.05 + Math.random() * 0.05;
      
      this.time = 0;
      this.lifetime = duration;
      
      this.setupElement();
      container.appendChild(this.element);
    }

    setupElement() {
      const { element, size, color, shape } = this;
      
      if (shape < 0.7) {
        // Rectangle
        element.style.width = `${size * 1.2}px`;
        element.style.height = `${size * 0.7}px`;
        element.style.borderRadius = '1px';
      } else if (shape < 0.9) {
        // Square
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
        element.style.borderRadius = '1px';
      } else {
        // Circle
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
        element.style.borderRadius = '50%';
      }
      
      element.style.backgroundColor = color;
      
      // Add subtle glow for depth
      element.style.boxShadow = `0 0 ${size * 0.5}px rgba(255, 255, 255, 0.5)`;
      
      // Some particles get gradient shimmer
      if (Math.random() > 0.6) {
        element.style.background = `linear-gradient(135deg, ${color} 0%, rgba(255, 255, 255, 0.4) 50%, ${color} 100%)`;
      }
    }

    update(deltaTime) {
      this.time += deltaTime;
      
      this.vy += this.gravity;
      this.vx *= this.drag;
      this.vy *= this.drag;
      
      // Add wobble/flutter effect
      const wobble = Math.sin(this.wobblePhase + this.time * this.wobbleSpeed) * 1.5;
      
      this.x += this.vx + wobble;
      this.y += this.vy;
      
      // Rotation continues throughout
      this.rotation += this.rotationSpeed;
      
      // Apply transforms
      this.element.style.left = `${this.x}px`;
      this.element.style.top = `${this.y}px`;
      this.element.style.transform = `rotate(${this.rotation}deg)`;
      
      // Fade out in final 30% of lifetime
      const lifeProgress = this.time / this.lifetime;
      if (lifeProgress > 0.7) {
        const fadeProgress = (lifeProgress - 0.7) / 0.3;
        this.element.style.opacity = Math.max(0, 1 - fadeProgress);
      }
      
      // Also fade based on y position
      const windowHeight = window.innerHeight;
      if (this.y > windowHeight) {
        const fadeProgress = Math.min(1, (this.y - windowHeight) / 100);
        this.element.style.opacity = Math.max(0, 1 - fadeProgress);
      }
      
      // Particle is alive if still in time and somewhat visible
      return this.time < this.lifetime && this.y < windowHeight + 100;
    }

    remove() {
      if (this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
    }
  }

  // Create particles with slight stagger
  const particles = [];
  const burstDuration = 400;
  
  for (let i = 0; i < confettiCount; i++) {
    setTimeout(() => {
      particles.push(new ConfettiParticle(i));
    }, (i / confettiCount) * burstDuration);
  }

  // Animation loop with delta time
  let lastTime = Date.now();
  let animationId;
  
  const animate = () => {
    const currentTime = Date.now();
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;
    
    let activeParticles = 0;
    
    particles.forEach(particle => {
      if (particle.update(deltaTime)) {
        activeParticles++;
      } else {
        particle.remove();
      }
    });
    
    if (activeParticles > 0) {
      animationId = requestAnimationFrame(animate);
    } else {
      particles.length = 0;
    }
  };

  animationId = requestAnimationFrame(animate);

  // Return cleanup function
  return () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    particles.forEach(particle => particle.remove());
    particles.length = 0;
  };
};

export default confetti;