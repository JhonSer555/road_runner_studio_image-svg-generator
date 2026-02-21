/**
 * Simple encryption/decryption utilities for API keys.
 * Note: This is client-side security to prevent plain-text exposure in localStorage.
 */

const SECRET_SALT = "road-runner-studio-v2";

/**
 * Encrypts a string using a master password.
 */
export const encryptKey = (text: string, password: string): string => {
    const combined = password + SECRET_SALT;
    const result = [];
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i) ^ combined.charCodeAt(i % combined.length);
        result.push(String.fromCharCode(charCode));
    }
    return btoa(result.join(''));
};

/**
 * Decrypts a string using a master password.
 */
export const decryptKey = (encoded: string, password: string): string => {
    try {
        const text = atob(encoded);
        const combined = password + SECRET_SALT;
        const result = [];
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i) ^ combined.charCodeAt(i % combined.length);
            result.push(String.fromCharCode(charCode));
        }
        return result.join('');
    } catch (e) {
        return "";
    }
};

/**
 * Creates a simple hash for password verification.
 */
export const hashPassword = (password: string): string => {
    let hash = 0;
    const combined = password + SECRET_SALT;
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
};
