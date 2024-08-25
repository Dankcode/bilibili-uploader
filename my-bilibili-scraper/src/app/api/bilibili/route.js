import { MergeVideoAudio } from './merge'

export async function GET() {
  try{
    return (
      <div>
        <MergeVideoAudio />
      </div>
    )
  } catch (error) {
    console.log(error)
  }

};
