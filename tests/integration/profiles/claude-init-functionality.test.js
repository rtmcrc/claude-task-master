import fs from 'fs';
import path from 'path';
import { claudeProfile } from '../../../src/profiles/claude.js';

describe('Claude Profile Initialization Functionality', () => {
	let claudeProfileContent;

	beforeAll(() => {
		const claudeJsPath = path.join(
			process.cwd(),
			'src',
			'profiles',
			'claude.js'
		);
		claudeProfileContent = fs.readFileSync(claudeJsPath, 'utf8');
	});

	test('claude.js has correct asset-only profile configuration', () => {
		// Check for explicit, non-default values in the source file
		expect(claudeProfileContent).toContain("name: 'claude'");
		expect(claudeProfileContent).toContain("displayName: 'Claude Code'");
		expect(claudeProfileContent).toContain("profileDir: '.'"); // non-default
		expect(claudeProfileContent).toContain("rulesDir: '.'"); // non-default
		expect(claudeProfileContent).toContain('mcpConfig: false'); // non-default
		expect(claudeProfileContent).toContain('includeDefaultRules: false'); // non-default
		expect(claudeProfileContent).toContain("'AGENTS.md': 'CLAUDE.md'");

		// Check the final computed properties on the profile object
		expect(claudeProfile.profileName).toBe('claude');
		expect(claudeProfile.displayName).toBe('Claude Code');
		expect(claudeProfile.profileDir).toBe('.');
		expect(claudeProfile.rulesDir).toBe('.');
		expect(claudeProfile.mcpConfig).toBe(false);
		expect(claudeProfile.mcpConfigName).toBe(null); // computed
		expect(claudeProfile.includeDefaultRules).toBe(false);
		expect(claudeProfile.fileMap['AGENTS.md']).toBe('CLAUDE.md');
	});

	test('claude.js has lifecycle functions for file management', () => {
		expect(claudeProfileContent).toContain('function onAddRulesProfile');
		expect(claudeProfileContent).toContain('function onRemoveRulesProfile');
		expect(claudeProfileContent).toContain(
			'function onPostConvertRulesProfile'
		);
	});

	test('claude.js handles .claude directory in lifecycle functions', () => {
		expect(claudeProfileContent).toContain('.claude');
		expect(claudeProfileContent).toContain('copyRecursiveSync');
	});

	test('claude.js has proper error handling in lifecycle functions', () => {
		expect(claudeProfileContent).toContain('try {');
		expect(claudeProfileContent).toContain('} catch (err) {');
		expect(claudeProfileContent).toContain("log('error'");
	});
});
