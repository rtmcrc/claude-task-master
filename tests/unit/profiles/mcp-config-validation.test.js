import { RULE_PROFILES } from '../../../src/constants/profiles.js';
import { getRulesProfile } from '../../../src/utils/rule-transformer.js';
import path from 'path';

describe('MCP Configuration Validation', () => {
	describe('Profile MCP Configuration Properties', () => {
		// Define base configurations
		const baseMcpConfigurations = {
			cline: {
				shouldHaveMcp: false,
				expectedDir: '.clinerules',
				expectedConfigName: 'cline_mcp_settings.json'
				// expectedPath will be generated
			},
			cursor: {
				shouldHaveMcp: true,
				expectedDir: '.cursor',
				expectedConfigName: 'mcp.json'
			},
			roo: {
				shouldHaveMcp: true,
				expectedDir: '.roo',
				expectedConfigName: 'mcp.json'
			},
			trae: {
				shouldHaveMcp: false,
				expectedDir: '.trae',
				expectedConfigName: 'trae_mcp_settings.json'
			},
			vscode: {
				shouldHaveMcp: true,
				expectedDir: '.vscode',
				expectedConfigName: 'mcp.json'
			},
			windsurf: {
				shouldHaveMcp: true,
				expectedDir: '.windsurf',
				expectedConfigName: 'mcp.json'
			}
		};

		// Generate expectedPath for each configuration using path.join
		const expectedMcpConfigurations = Object.entries(
			baseMcpConfigurations
		).reduce((acc, [profileName, config]) => {
			acc[profileName] = {
				...config,
				expectedPath: path.join(config.expectedDir, config.expectedConfigName)
			};
			return acc;
		}, {});

		Object.entries(expectedMcpConfigurations).forEach(
			([profileName, expected]) => {
				test(`should have correct MCP configuration for ${profileName} profile`, () => {
					const profile = getRulesProfile(profileName);
					expect(profile).toBeDefined();
					expect(profile.mcpConfig).toBe(expected.shouldHaveMcp);
					expect(profile.profileDir).toBe(expected.expectedDir);
					expect(profile.mcpConfigName).toBe(expected.expectedConfigName);
					expect(profile.mcpConfigPath).toBe(expected.expectedPath);
				});
			}
		);
	});

	describe('MCP Configuration Path Consistency', () => {
		test('should ensure all profiles have consistent mcpConfigPath construction', () => {
			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				if (profile.mcpConfig !== false) {
					const expectedPath = path.join(
						profile.profileDir,
						profile.mcpConfigName
					);
					expect(profile.mcpConfigPath).toBe(expectedPath);
				}
			});
		});

		test('should ensure no two profiles have the same MCP config path', () => {
			const mcpPaths = new Set();
			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				// Only consider profiles that actually have an MCP config path
				if (profile.mcpConfigPath) {
					expect(mcpPaths.has(profile.mcpConfigPath)).toBe(false);
					mcpPaths.add(profile.mcpConfigPath);
				}
			});
		});

		test('should ensure all MCP-enabled profiles use proper directory structure', () => {
			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				if (profile.mcpConfig !== false) {
					// Check 1: profileDir starts with a dot (unless it's the root dir for simple profiles)
					if (profile.profileDir !== '.') {
						expect(profile.profileDir.startsWith('.')).toBe(true);
					}
					// Check 2: mcpConfigName is a non-empty string and looks like a filename
					expect(typeof profile.mcpConfigName).toBe('string');
					expect(profile.mcpConfigName.length).toBeGreaterThan(0);
					expect(profile.mcpConfigName).toMatch(/^[\w_.-]+$/); // Basic filename check

					// Check 3: mcpConfigPath is correctly formed from profileDir and mcpConfigName
					const expectedConfigPath = path.join(profile.profileDir, profile.mcpConfigName);
					expect(profile.mcpConfigPath).toBe(expectedConfigPath);
				}
			});
		});

		test('should ensure all profiles have required MCP properties', () => {
			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				expect(profile).toHaveProperty('mcpConfig');
				expect(profile).toHaveProperty('profileDir');
				expect(profile).toHaveProperty('mcpConfigName');
				expect(profile).toHaveProperty('mcpConfigPath');
			});
		});
	});

	describe('MCP Configuration File Names', () => {
		test('should use standard mcp.json for MCP-enabled profiles', () => {
			const standardMcpProfiles = ['cursor', 'roo', 'vscode', 'windsurf'];
			standardMcpProfiles.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				expect(profile.mcpConfigName).toBe('mcp.json');
			});
		});

		test('should use profile-specific config name for non-MCP profiles', () => {
			const clineProfile = getRulesProfile('cline');
			expect(clineProfile.mcpConfigName).toBe('cline_mcp_settings.json');

			const traeProfile = getRulesProfile('trae');
			expect(traeProfile.mcpConfigName).toBe('trae_mcp_settings.json');
		});
	});

	describe('Profile Directory Structure', () => {
		test('should ensure each profile has a unique directory', () => {
			const profileDirs = new Set();
			// Simple profiles that use root directory (can share the same directory)
			const simpleProfiles = ['claude', 'codex'];

			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);

				// Simple profiles can share the root directory
				if (simpleProfiles.includes(profileName)) {
					expect(profile.profileDir).toBe('.');
					return;
				}

				// Full profiles should have unique directories
				expect(profileDirs.has(profile.profileDir)).toBe(false);
				profileDirs.add(profile.profileDir);
			});
		});

		test('should ensure profile directories follow expected naming convention', () => {
			// Simple profiles that use root directory
			const simpleProfiles = ['claude', 'codex'];

			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);

				// Simple profiles use root directory
				if (simpleProfiles.includes(profileName)) {
					expect(profile.profileDir).toBe('.');
					return;
				}

				// Full profiles should follow the .name pattern
				expect(profile.profileDir).toMatch(/^\.[\w-]+$/);
			});
		});
	});

	describe('MCP Configuration Creation Logic', () => {
		test('should indicate which profiles require MCP configuration creation', () => {
			const mcpEnabledProfiles = RULE_PROFILES.filter((profileName) => {
				const profile = getRulesProfile(profileName);
				return profile.mcpConfig !== false;
			});

			expect(mcpEnabledProfiles).toContain('cursor');
			expect(mcpEnabledProfiles).toContain('roo');
			expect(mcpEnabledProfiles).toContain('vscode');
			expect(mcpEnabledProfiles).toContain('windsurf');
			expect(mcpEnabledProfiles).not.toContain('claude');
			expect(mcpEnabledProfiles).not.toContain('cline');
			expect(mcpEnabledProfiles).not.toContain('codex');
			expect(mcpEnabledProfiles).not.toContain('trae');
		});

		test('should provide all necessary information for MCP config creation', () => {
			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				if (profile.mcpConfig !== false) {
					expect(profile.mcpConfigPath).toBeDefined();
					expect(typeof profile.mcpConfigPath).toBe('string');
					expect(profile.mcpConfigPath.length).toBeGreaterThan(0);
				}
			});
		});
	});

	describe('MCP Configuration Path Usage Verification', () => {
		test('should verify that rule transformer functions use mcpConfigPath correctly', () => {
			// This test verifies that the mcpConfigPath property exists and is properly formatted
			// for use with the setupMCPConfiguration function
			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				if (profile.mcpConfig !== false) {
					// Verify the path is properly formatted for path.join usage
					expect(profile.mcpConfigPath.startsWith(path.sep)).toBe(false); // It's a relative path
					// Check if it contains a path separator, rather than specifically '/'
					expect(profile.mcpConfigPath).toMatch(new RegExp(`\\${path.sep}`));


					// Verify it matches the expected pattern: profileDir/configName
					const expectedPath = path.join(profile.profileDir, profile.mcpConfigName);
					expect(profile.mcpConfigPath).toBe(expectedPath);
				}
			});
		});

		test('should verify that mcpConfigPath is properly constructed for path.join usage', () => {
			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				if (profile.mcpConfig !== false) {
					// Test that path.join works correctly with the mcpConfigPath
					// Use an OS-neutral root for testing purposes if possible, or accept that results vary.
					// For this test, we're verifying that path.join(root, relativePath) works as expected.
					const testProjectRoot = 'test_project_root_dir'; // A simple relative root
					const fullPath = path.join(testProjectRoot, profile.mcpConfigPath);
					const expectedFullPath = path.join(testProjectRoot, profile.profileDir, profile.mcpConfigName);

					// Should result in a proper path
					expect(fullPath).toBe(expectedFullPath);
					// These assertions are implicitly covered by the above if profile.mcpConfigPath is correct
					// expect(fullPath).toContain(profile.profileDir);
					// expect(fullPath).toContain(profile.mcpConfigName);
				}
			});
		});
	});

	describe('MCP Configuration Function Integration', () => {
		test('should verify that setupMCPConfiguration receives the correct mcpConfigPath parameter', () => {
			// This test verifies the integration between rule transformer and mcp-utils
			RULE_PROFILES.forEach((profileName) => {
				const profile = getRulesProfile(profileName);
				if (profile.mcpConfig !== false) {
					// Verify that the mcpConfigPath can be used directly with setupMCPConfiguration
					// The function signature is: setupMCPConfiguration(projectDir, mcpConfigPath)
					expect(profile.mcpConfigPath).toBeDefined();
					expect(typeof profile.mcpConfigPath).toBe('string');

					// Verify the path structure is correct for the new function signature
					// It should be equivalent to path.join(profileDir, mcpConfigName)
					const expectedStructure = path.join(profile.profileDir, profile.mcpConfigName);
					expect(profile.mcpConfigPath).toBe(expectedStructure);
				}
			});
		});
	});
});
