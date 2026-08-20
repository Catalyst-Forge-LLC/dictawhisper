(() => {
	const btn = document.querySelector('[data-docs-menu]');
	if (btn) {
		btn.addEventListener('click', () => {
			document.body.classList.toggle('docs-nav-open');
		});
	}

	const links = [...document.querySelectorAll('.docs-toc a[href^="#"]')];
	if (links.length === 0) return;

	const map = new Map();
	for (const a of links) {
		const id = a.getAttribute('href')?.slice(1);
		if (!id) continue;
		const el = document.getElementById(id);
		if (el) map.set(el, a);
	}

	const obs = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const a = map.get(entry.target);
				if (!a) continue;
				for (const l of links) l.classList.remove('active');
				a.classList.add('active');
			}
		},
		{ rootMargin: '-20% 0px -70% 0px', threshold: 0 },
	);

	for (const el of map.keys()) obs.observe(el);
})();
