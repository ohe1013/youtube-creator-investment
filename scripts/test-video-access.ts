
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    const count = await prisma.video.count()
    console.log('Video count:', count)
  } catch (e) {
    console.error('Error accessing prisma.video:', e)
  } finally {
    await prisma.$disconnect()
  }
}

main()
