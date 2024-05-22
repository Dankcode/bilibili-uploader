'use client'

import React from 'react';
import { useForm } from 'react-hook-form';

const PostForm = () => {
  const { register, handleSubmit, formState: { errors } } = useForm({ mode: 'all' }); // Use 'all' mode for full field validation

  const onSubmit = async (data) => {
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const responseJson = await response.json();

      if (responseJson.success) {
        console.log('Post created successfully!');
        // Handle successful post creation (e.g., clear form, display success message)
        // You can't directly modify form state in Server Components, consider using a state management library like Redux or Zustand for form state if needed
      } else {
        console.error('Error creating post:', responseJson.error);
        // Handle error scenario (e.g., display error message)
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      // Handle general form submission error
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
    <label htmlFor="chineseName">Chinese Name:</label>
    <input
      type="text"
      id="chineseName"
      {...register('Chinese_Name', { required: true })} // Use register with validation rule
    />
    {errors.Chinese_Name && <span className="error">{errors.Chinese_Name.message}</span>}
    <label htmlFor="chineseDesc">Chinese Description:</label>
    <textarea
      id="chineseDesc"
      {...register('Chinese_Desc', { required: true })} // Use register with validation rule
    />
    {errors.Chinese_Desc && <span className="error">{errors.Chinese_Desc.message}</span>}
    <label htmlFor="engName">English Name:</label>
    <input
      type="text"
      id="engName"
      {...register('Eng_Name', { required: true })} // Use register with validation rule
    />
    {errors.Eng_Name && <span className="error">{errors.Eng_Name.message}</span>}
    <label htmlFor="engDesc">English Description:</label>
    <textarea
      id="engDesc"
      {...register('Eng_Desc', { required: true })} // Use register with validation rule
    />
    {errors.Eng_Desc && <span className="error">{errors.Eng_Desc.message}</span>}
    <label htmlFor="biliURL">Bilibili URL:</label>
    <input
      type="url"
      id="biliURL"
      {...register('BiliURL')} // Optional validation (e.g., pattern for URL format)
    />
    {errors.BiliURL && <span className="error">{errors.BiliURL.message}</span>}
    <label htmlFor="valid">Valid:</label>
    <input
      type="checkbox"
      id="valid"
      {...register('Valid')} // No validation needed for boolean
    />
    <label htmlFor="uploadDate">Upload Date:</label>
    <input
      type="date"
      id="uploadDate"
      {...register('Upload_Date', { required: true })} // Use register with validation rule
    />
    {errors.Upload_Date && <span className="error">{errors.Upload_Date.message}</span>}
    <label htmlFor="youtubeURL">Youtube URL:</label>
    <input
      type="url"
      id="youtubeURL"
      {...register('YoutubeURL')} // Optional validation (e.g., pattern for URL format)
    />
    {errors.YoutubeURL && <span className="error">{errors.YoutubeURL.message}</span>}
    <button type="submit">Create Post</button>
  </form>
  );
};

export default PostForm;