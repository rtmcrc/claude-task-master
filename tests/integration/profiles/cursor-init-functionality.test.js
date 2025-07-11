import fs from 'fs';
import path from 'path';
import { cursorProfile } from '../../../src/profiles/cursor.js';

describe('Cursor Profile Initialization Functionality', () => {
	let cursorProfileContent;

	beforeAll(() => {
		const cursorJsPath = path.join(
			process.cwd(),
			'src',
			'profiles',
			'cursor.js'
		);
		cursorProfileContent = fs.readFileSync(cursorJsPath, 'utf8');
	});

	test('cursor.js uses factory pattern with correct configuration', () => {
		// Check for explicit, non-default values in the source file
		expect(cursorProfileContent).toContain("name: 'cursor'");
		expect(cursorProfileContent).toContain("displayName: 'Cursor'");
		expect(cursorProfileContent).toContain("url: 'cursor.so'");
		expect(cursorProfileContent).toContain("docsUrl: 'docs.cursor.com'");
		expect(cursorProfileContent).toContain("targetExtension: '.mdc'"); // non-default

		// Check the final computed properties on the profile object
		expect(cursorProfile.profileName).toBe('cursor');
		expect(cursorProfile.displayName).toBe('Cursor');
		expect(cursorProfile.profileDir).toBe('.cursor'); // default
		expect(cursorProfile.rulesDir).toBe('.cursor/rules'); // default
		expect(cursorProfile.mcpConfig).toBe(true); // default
		expect(cursorProfile.mcpConfigName).toBe('mcp.json'); // default
	});

	test('cursor.js preserves .mdc extension in both input and output', () => {
		// Check that the profile object has the correct file mapping behavior (cursor keeps .mdc)
		expect(cursorProfile.fileMap['rules/cursor_rules.mdc']).toBe(
			'cursor_rules.mdc'
		);
		// Also check that targetExtension is explicitly set in the file
		expect(cursorProfileContent).toContain("targetExtension: '.mdc'");
	});

	test('cursor.js uses standard tool mappings (no tool renaming)', () => {
		// Check that the profile uses default tool mappings (equivalent to COMMON_TOOL_MAPPINGS.STANDARD)
		// This verifies the architectural pattern: no custom toolMappings = standard tool names
		expect(cursorProfileContent).not.toContain('toolMappings:');
		expect(cursorProfileContent).not.toContain('apply_diff');
		expect(cursorProfileContent).not.toContain('search_files');

		// Verify the result: default mappings means tools keep their original names
		expect(cursorProfile.conversionConfig.toolNames.edit_file).toBe(
			'edit_file'
		);
		expect(cursorProfile.conversionConfig.toolNames.search).toBe('search');
	});
});
