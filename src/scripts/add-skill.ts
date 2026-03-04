
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const repoUrl = args[0];
const skillNameIndex = args.indexOf('--skill') + 1;
const skillName = args[skillNameIndex];

if (!repoUrl || !skillName) {
    console.error('Usage: npm run skill:add -- <repo_url> --skill <skill_name>');
    process.exit(1);
}

const skillsDir = path.resolve(process.cwd(), 'skills');
if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
}

const targetDir = path.join(skillsDir, skillName);

if (fs.existsSync(targetDir)) {
    console.log(`Skill '${skillName}' already exists at ${targetDir}`);
    // Optional: pull latest
    try {
        execSync('git pull', { cwd: targetDir, stdio: 'inherit' });
    } catch (e) {
        console.warn('Failed to pull latest changes:', e);
    }
} else {
    console.log(`Cloning ${repoUrl} to ${targetDir}...`);
    try {
        execFileSync('git', ['clone', repoUrl, targetDir], { stdio: 'inherit' });
    } catch (e) {
        console.error('Failed to clone repository:', e);
        process.exit(1);
    }
}

// Check if there is an install script
if (fs.existsSync(path.join(targetDir, 'package.json'))) {
    console.log(`Installing dependencies for ${skillName}...`);
    try {
        execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
    } catch (e) {
        console.warn('Failed to install dependencies:', e);
    }
}

console.log(`Skill '${skillName}' added successfully.`);
