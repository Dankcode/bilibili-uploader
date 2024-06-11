import os
import subprocess

def convert_hevc_to_mp4(input_dir, output_dir):
  """
  Finds HEVC files in a directory and converts them to MP4 using ffmpeg.

  Args:
      input_dir: Path to the directory containing HEVC files.
      output_dir: Path to the directory where converted MP4 files will be saved. (Optional, defaults to the same directory as input)
  """
  # Check if ffmpeg is installed
  try:
    subprocess.check_output(["ffmpeg", "-version"], stderr=subprocess.STDOUT)
  except FileNotFoundError:
    print("Error: ffmpeg is not installed. Please install it from https://ffmpeg.org/download.html")
    return

  # Create output directory if it doesn't exist
  if output_dir is None:
    output_dir = input_dir
  os.makedirs(output_dir, exist_ok=True)

  # Loop through all files in the input directory
  for filename in os.listdir(input_dir):
    # Check if it's an HEVC file
    if filename.endswith(".mp4"):
      # Construct input and output file paths
      input_file = os.path.join(input_dir, filename)
      output_file = os.path.join(output_dir, os.path.splitext(filename)[0] + ".mp4")

      # Convert the HEVC file to MP4 using ffmpeg
      command = ["ffmpeg", "-i", input_file, "-c:v libx264", output_file]
      subprocess.run(command)
      print(f"Converted {filename} to {output_file}")

# Replace with the actual paths to your folder and desired output directory (optional)
input_dir = "/hvec_vid"
output_dir = "/compilation_vids"  # Optional, defaults to input_dir

convert_hevc_to_mp4(input_dir, output_dir)