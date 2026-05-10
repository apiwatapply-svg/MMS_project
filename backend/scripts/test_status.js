const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    const status = await prisma.tb_MCStatus.findMany({
        where: { MC: "ABR-003" },
        orderBy: { Datetime: "desc" },
        take: 10
    });
    console.log(status);
}
test().finally(() => prisma.$disconnect());
