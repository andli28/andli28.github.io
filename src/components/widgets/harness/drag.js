// Pointer dragging for chips. The ghost is a copy of the element that was
// grabbed, and the spot that was grabbed stays under the pointer.
//
//   makeDraggable(el, {
//     host,        element the ghost is appended to (needs the theme variables)
//     canStart(),  false to ignore the press
//     onStart(),   the drag has begun (pointer moved past the threshold)
//     onDrop(el),  element under the pointer on release; return true if the
//                  drop was taken, false to send the ghost back
//   })

const THRESHOLD = 6;
const reduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function makeDraggable(el, { host, canStart, onStart, onDrop }) {
  el.addEventListener("pointerdown", down => {
    if (down.button > 0 || !canStart()) return;
    const from = el.getBoundingClientRect();
    const gx = down.clientX - from.left;
    const gy = down.clientY - from.top;
    let ghost = null;

    const at = (x, y, scale) =>
      `translate3d(${x - gx}px, ${y - gy}px, 0) scale(${scale})`;

    const move = e => {
      if (!ghost) {
        if (
          Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) <
          THRESHOLD
        )
          return;
        ghost = el.cloneNode(true);
        ghost.classList.remove("ah-armed", "ah-hinted", "ah-settle");
        ghost.classList.add("ah-ghost");
        ghost.removeAttribute("data-key");
        ghost.style.width = `${from.width}px`;
        ghost.style.height = `${from.height}px`;
        ghost.style.transformOrigin = `${gx}px ${gy}px`;
        host.append(ghost);
        try {
          el.setPointerCapture(down.pointerId);
        } catch {
          // the pointer is already gone; window listeners still cover us
        }
        el.classList.add("ah-lifted");
        onStart();
      }
      ghost.style.transform = at(e.clientX, e.clientY, 1.04);
      e.preventDefault();
    };

    const end = e => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!ghost) return;
      const g = ghost;
      ghost = null;
      const under =
        e.type === "pointerup"
          ? document.elementFromPoint(e.clientX, e.clientY)
          : null;
      const taken = onDrop(under);
      el.classList.remove("ah-lifted");
      if (taken || reduced()) g.remove();
      else {
        // not a valid spot: glide back to where it came from
        g.classList.add("ah-return");
        g.style.transform = at(from.left + gx, from.top + gy, 1);
        g.style.opacity = "0";
        setTimeout(() => g.remove(), 200);
      }
      // the click that follows a drag isn't a tap
      const eat = c => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", eat, true), 60);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
}
