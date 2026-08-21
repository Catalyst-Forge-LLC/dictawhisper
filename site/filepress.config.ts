import { defineFilepressConfig } from 'getfilepress';

const github = 'https://github.com/Catalyst-Forge-LLC/dictawhisper';

export default defineFilepressConfig({
	title: 'DictaWhisper',
	description:
		'A local voice journal. Speak, transcribe on your GPU, keep notes as files next to the audio.',
	tagline: 'Dictation, meet Whisper.',
	lede: 'Speak, keep the note, stay on your machine.',
	url: 'https://dictawhisper.com',
	author: 'Catalyst Forge LLC',
	logo: '/logo.png',
	homePage: 'about',
	topics: [
		{ label: 'Guides', tag: 'guides' },
		{ label: 'Release notes', tag: 'releases' }
	],
	nav: [
		{ label: 'Home', href: '/' },
		{ label: 'Docs', href: '/docs' },
		{ label: 'Posts', href: '/writing' },
		{ label: 'Install', href: '/install' },
		{ label: 'GitHub', href: github, icon: 'github' }
	],
	footerLinks: [
		{ label: 'Docs', href: '/docs' },
		{ label: 'RSS', href: '/rss.xml' },
		{ label: 'Topics', href: '/topics' },
		{ label: 'GitHub', href: github, icon: 'github' },
		{ label: 'AppFacts', href: 'https://appfacts.dev/v#af1.eNpVkltr3DAQhf-KmKcWtGvyqqeASaG5lFDnrZQwK0-8imVJaMbemGX_e5H31n0Tc74ZnTnSHiYwdxoCDgQGWmcFd1vHiTJokDmV6o42ClNS35rm93fQwIIyMhhAK24i0OCdpcCFffn5diRsD2YPHkM3YleUtzlRY7NLotUjTng-v86yjQE05DGIW2z8ii2tP_k_7SPjQLuYezDQTOSFnpxo9fCVMjEvN87eha7IddNoVTcNaEAHBj6QhfLqtJZW0XsMJKDBxmEYg7MoLgYwwNH2JGsX4aChpcRg_uyhKPe8XPrJVe9KZypzcwxCoVVXcwd9xOniq4AbtH3hmPJE-QLd-jqxkjHwkoyLQVHoXKBLx9V5Qb0flF0siEo5WmIuCZzh6zJHPBP6VQlY3a595u-H2JJfBn5JylGijb7itj_1v9Sv6lxWPKYUs8Dhr4bN6HxbHjuh7bGj9wEDdpTBQAppKFlmSpGdxDyDga1IYlNVnZPtuFnbOFQ1CvqZZfUj5o5Wz891dfMVD_8Ay7foKw' },
		{ label: 'ToolFacts', href: 'https://toolfacts.dev/v#tf1.eNrFlE1v2zAMhv-KoHO-tt2y05ChpwwY0MMORRGoEmNrtSWXop0GQf77XioN9oH1nItjkC_58mEsnexk1x9mNrme7Np-jV7cjzaWgdh823w398QTsZ3ZQBN1GWGoNk5cdyxi7jI3hCQkJeaE1GqxWnxCpIiTsSDgvMRJNV30lIqafBmcb2n-cbFC-DmmgFjvh3m5evGYJOo8J0uv5Ee59O6yd9184OypFMiEXSpDZkGuSIjZnmfWMwVCueuK1jO9jBEhu354RJYa1lokhDrqSfiI4pQTVcQiMTl1K296yVn7PJyuCwq6oMNlQbtCjn2rtDHQjvZ78qLMTC4oBoFTvfaxo4J9Ua-TemxR04nkkPn5t_8bGaHFHuMT_NG3H7IAyK6FR4Jo5CHXNd5XdzNlLNYkiIp5Ohq0DGVmxDV4ZjbqrbN_NkwycipmcNIiFxwqrkKXgnGmtFimGZimSAcs8__UDclO7W7FfUcCbJRWaGXWMbzjSqbMY4ovIzKu_IPuO3KJghF6lcqs9O-CdrHIripuRLrFAHVEE5ORlszPDAzXmUMEqM84Ju9Pz-S16S1HT3Qg_anf5j4y3uvkedAzBg6w1b8huKPBYW5IP1fBZWLPjzPb5p4G12i7VmQo6-XyT8KFz30FgWWUXE_yVdfAZnxSxfJ6Wc3rZTXfbjd_dan3yJg8TkO4YJx_AeesyY0' }
	],
	paths: [{ url: '/docs', dir: 'docs/dist' }]
});
