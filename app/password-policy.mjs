export const passwordHint='Use 12–128 characters, including at least three of: lowercase, uppercase, numbers and symbols.';
export function passwordError(value,confirmation){
 if(typeof value!=='string'||value.length<12||value.length>128||value.trim()!==value)return passwordHint;
 if([/[a-z]/,/[A-Z]/,/[0-9]/,/[^a-zA-Z0-9\s]/].filter(re=>re.test(value)).length<3)return passwordHint;
 if(confirmation!==value)return 'New passwords do not match.';
 return '';
}
