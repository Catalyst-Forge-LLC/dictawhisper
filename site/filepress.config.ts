import { defineFilepressConfig } from 'getfilepress';

const github = 'https://github.com/Catalyst-Forge-LLC/dictawhisper';

export default defineFilepressConfig({
	title: 'DictaWhisper',
	description:
		'A local voice journal. Speak, transcribe on your GPU, keep notes as files next to the audio.',
	tagline: 'Dictation, meet Whisper.',
	lede: 'Local audio · sidecar notes · ollanet cleanup',
	url: 'https://dictawhisper.com',
	author: 'Catalyst Forge LLC',
	homePage: 'about',
	topics: [
		{ label: 'Guides', tag: 'guides' },
		{ label: 'Release notes', tag: 'releases' }
	],
	nav: [
		{ label: 'Home', href: '/' },
		{ label: 'Posts', href: '/writing' },
		{ label: 'Install', href: '/install' },
		{ label: 'GitHub', href: github, icon: 'github' }
	],
	footerLinks: [
		{ label: 'RSS', href: '/rss.xml' },
		{ label: 'Topics', href: '/topics' },
		{ label: 'GitHub', href: github, icon: 'github' }
	]
});
