export default function confetti() {
    // Simple confetti implementation without external dependencies
    const colors = ['#14B8A6', '#0891B2', '#FFFFFF', '#67E8F9', '#5EEAD4'];
    
    for (let i = 0; i < 50; i++) {
      createConfettiPiece(colors[Math.floor(Math.random() * colors.length)]);
    }
  }
  
  function createConfettiPiece(color) {
    const confetti = document.createElement('div');
    confetti.style.position = 'fixed';
    confetti.style.width = '10px';
    confetti.style.height = '10px';
    confetti.style.backgroundColor = color;
    confetti.style.left = Math.random() * window.innerWidth + 'px';
    confetti.style.top = '-10px';
    confetti.style.zIndex = '9999';
    confetti.style.pointerEvents = 'none';
    confetti.style.borderRadius = '2px';
    confetti.style.opacity = '0.8';
    
    document.body.appendChild(confetti);
    
    const animation = confetti.animate([
      {
        transform: `translateY(0px) rotate(0deg)`,
        opacity: 0.8
      },
      {
        transform: `translateY(${window.innerHeight + 20}px) rotate(360deg)`,
        opacity: 0
      }
    ], {
      duration: Math.random() * 2000 + 1000,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    });
    
    animation.onfinish = () => {
      if (confetti.parentNode) {
        confetti.parentNode.removeChild(confetti);
      }
    };
  }