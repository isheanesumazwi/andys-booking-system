import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PHOTOS = [
  ['/images/workshop-1.jpg', 'Mechanic tightening a bolt in an engine bay with a ratchet'],
  ['/images/workshop-2.jpg', 'Mechanic working under an open bonnet in the workshop'],
  ['/images/workshop-3.jpg', 'Smiling mechanic at the workbench'],
];

export default function PhotoCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const go = (next) => setIndex((next + PHOTOS.length) % PHOTOS.length);
  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % PHOTOS.length), 5000);
    return () => clearInterval(timer);
  }, [paused]);
  return <div className="carousel" role="region" aria-roledescription="carousel" aria-label="Workshop photos"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <div className="carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
      {PHOTOS.map(([src, alt], i) => <img key={src} src={src} alt={alt} aria-hidden={i !== index} loading={i === 0 ? 'eager' : 'lazy'} />)}
    </div>
    <button type="button" className="carousel-arrow carousel-prev" aria-label="Previous photo" onClick={() => go(index - 1)}><ChevronLeft size={20} /></button>
    <button type="button" className="carousel-arrow carousel-next" aria-label="Next photo" onClick={() => go(index + 1)}><ChevronRight size={20} /></button>
    <div className="carousel-dots">{PHOTOS.map(([src], i) => <button type="button" key={src} aria-label={`Show photo ${i + 1} of ${PHOTOS.length}`} aria-current={i === index} onClick={() => go(i)} />)}</div>
  </div>;
}
