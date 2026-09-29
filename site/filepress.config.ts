import { defineFilepressConfig } from 'getfilepress';

const github = 'https://github.com/Catalyst-Forge-LLC/dictawhisper';

export default defineFilepressConfig({
	title: 'DictaWhisper',
	description:
		'A local voice journal. Speak, transcribe on your GPU, keep notes as files next to the audio.',
	tagline: 'Dictation, meet Whisper.',
	lede: 'Speak · keep the note · your machine',
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
		{ label: 'See the rest of the Catalyst Forge shelf.', href: 'https://catalystforge.com/tools/' },
		{ label: 'Docs', href: '/docs' },
		{ label: 'RSS', href: '/rss.xml' },
		{ label: 'Topics', href: '/topics' },
		{ label: 'GitHub', href: github, icon: 'github' },
		{ label: 'AppFacts', href: 'https://appfacts.dev/v#af1.eNpVkk1v2zAMhv-KwNMKKDF29alAtgHb2qKYC-wwDAMjs45qWRREOqkR5L8Pcr6am0A-JN-X4h62UH-2EHEgqOGLd4q_N14SZbCgUyrRHa0NpmQ-Nc2vO7AgijoK1IBO_ZbAQvCOohT28fvLkXA91HsIGLsRu5J5mRI1Lvuk1vzALZ7fz5NuOIKFPEb1s4wnbmn5Jh9yrxkH2nHuoYZmS0Hpp1drvr6nTCLzxCn42JX0qmmsWTUNWEAPNbyiKOXF7mjLGg4BIylYcDwMY_QO1XOEGoRdT7r0DAcLLSWB-s8eSuZe5qFvUvW-VKbSN3NUiq25ijvYI04XXQVco-sLJ5S3lC_Qra4TqxmjzJvxHA3Fzke6VFyVFzSEwbhZgpqU2ZFI2cAZvpo54pkwLMqCza3tM38_cEthbviuKbOy41BJ25_qH1fP5hw2MqbEWeHw18J69KEtn53Q9djRvwEjdpShhhTTUHa54YHS8Qw2qknqqmrLqZ28Lx0P5QAosXjlPH3gOq-bcV2IaoWKYRJdfOPc0eLhYXXTBQ7_AXxQ9V4' },
		{ label: 'ToolFacts', href: 'https://toolfacts.dev/v#tf1.eNrFlE1v2zAMhv-KoHO-tt2y05ChpwwY0MMORRGoEmNrtSWXop0GQf77XioN9oH1nItjkC_58mEsnexk1x9mNrme7Np-jV7cjzaWgdh823w398QTsZ3ZQBN1GWGoNk5cdyxi7jI3hCQkJeaE1GqxWnxCpIiTsSDgvMRJNV30lIqafBmcb2n-cbFC-DmmgFjvh3m5evGYJOo8J0uv5Ee59O6yd9184OypFMiEXSpDZkGuSIjZnmfWMwVCueuK1jO9jBEhu354RJYa1lokhDrqSfiI4pQTVcQiMTl1K296yVn7PJyuCwq6oMNlQbtCjn2rtDHQjvZ78qLMTC4oBoFTvfaxo4J9Ua-TemxR04nkkPn5t_8bGaHFHuMT_NG3H7IAyK6FR4Jo5CHXNd5XdzNlLNYkiIp5Ohq0DGVmxDV4ZjbqrbN_NkwycipmcNIiFxwqrkKXgnGmtFimGZimSAcs8__UDclO7W7FfUcCbJRWaGXWMbzjSqbMY4ovIzKu_IPuO3KJghF6lcqs9O-CdrHIripuRLrFAHVEE5ORlszPDAzXmUMEqM84Ju9Pz-S16S1HT3Qg_anf5j4y3uvkedAzBg6w1b8huKPBYW5IP1fBZWLPjzPb5p4G12i7VmQo6-XyT8KFz30FgWWUXE_yVdfAZnxSxfJ6Wc3rZTXfbjd_dan3yJg8TkO4YJx_AeesyY0' }
	],
	paths: [{ url: '/docs', dir: 'docs/dist' }]
});
