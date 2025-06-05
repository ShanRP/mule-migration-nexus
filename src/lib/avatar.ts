import { supabase } from "@/integrations/supabase/client";

const AVATAR_BUCKET = 'avatar';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export const uploadAvatar = async (file: File, userId: string): Promise<string> => {
  // Validate file
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File size too large. Maximum size is 5MB.');
  }

  try {
    // Create a unique file name
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    // Upload file to Supabase Storage
    const { error: uploadError, data } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error('Failed to upload avatar: ' + uploadError.message);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (error) {
    console.error('Avatar upload error:', error);
    throw error;
  }
};

export const deleteAvatar = async (avatarUrl: string): Promise<void> => {
  try {
    // Extract file path from URL
    const filePath = avatarUrl.split('/').pop();
    if (!filePath) {
      console.warn('No file path found in avatar URL');
      return;
    }

    // Delete file from Supabase Storage
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .remove([filePath]);

    if (error) {
      console.error('Delete error:', error);
      throw new Error('Failed to delete avatar: ' + error.message);
    }
  } catch (error) {
    console.error('Avatar deletion error:', error);
    throw error;
  }
}; 