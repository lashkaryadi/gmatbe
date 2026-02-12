import JobApplication from "../models/jobApplication.js";
import Job from "../models/Job.js";
import User from "../models/User.js";
import Institution from "../models/Institution.js";
import Transaction from "../models/Transaction.js";
import mongoose from "mongoose";

// ---------------- APPLY TO JOB ----------------

export async function applyToJob(req, res) {
  try {
    const { jobId, message } = req.body;

    // 1️⃣ Validate job exists and is active
    const job = await Job.findById(jobId);
    if (!job || job.status !== "active") {
      return res.status(404).json({ message: "Job not available" });
    }

    // 2️⃣ Atomically deduct credit using findOneAndUpdate to prevent race conditions
    const user = await User.findOneAndUpdate(
      { _id: req.user._id, credits: { $gte: 1 } },
      { $inc: { credits: -1 } },
      { new: true } // Return updated document
    );

    if (!user) {
      return res.status(402).json({ message: "Insufficient credits" });
    }

    // 3️⃣ Create application - wrap in try-catch to handle potential duplicate key errors
    try {
      const application = await JobApplication.create({
        job: job._id,
        tutor: req.user._id,
        institution: job.institution,
        message: message || "",
      });

      // 4️⃣ Log transaction after successful application creation
      await Transaction.create({
        user: req.user._id,
        type: "CREDIT_DEBIT",
        credits: -1,
        reason: "JOB_APPLY",
        balanceAfter: user.credits,
      });

      return res.status(201).json({
        success: true,
        application,
      });
    } catch (createErr) {
      // If application creation failed, refund the deducted credit
      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { credits: 1 } } // Refund the credit
      );

      // Handle duplicate key error specifically
      if (createErr.code === 11000) {
        return res.status(400).json({
          message: "Already applied to this job",
        });
      }

      throw createErr; // Re-throw other errors
    }
  } catch (err) {
    console.error("applyToJob error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ---------------- VIEW MY APPLICATIONS ----------------
export async function getMyApplications(req, res) {
  try {
    const applications = await JobApplication.find({
      tutor: req.user._id,
    })
      .populate("job")
      .sort({ createdAt: -1 });

    return res.json({ success: true, applications });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
}

// ---------------- VIEW JOB APPLICATIONS (OWNER) ----------------
export async function getJobApplications(req, res) {
  try {
    const job = await Job.findOne({
      _id: req.params.jobId,
      postedBy: req.user._id,
    });

    if (!job) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const applications = await JobApplication.find({
      job: job._id,
    })
      .populate("tutor", "name email phone")
      .sort({ createdAt: -1 });

    return res.json({ success: true, applications });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
}

// ---------------- GET RECEIVED APPLICATIONS (Institution) ----------------
export async function getReceivedApplications(req, res) {
  try {
    const institution = await Institution.findOne({
      owner: req.user._id,
    });

    if (!institution) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const applications = await JobApplication.find({
      institution: institution._id,
    })
      .populate("job", "title")
      .populate("tutor", "name email phone")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      applications,
    });
  } catch (err) {
    console.error("getReceivedApplications error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ---------------- UPDATE APPLICATION STATUS ----------------
export async function updateApplicationStatus(req, res) {
  try {
    const { status } = req.body;
    const { applicationId } = req.params;

    // 1. Find the application
    const application = await JobApplication.findById(applicationId).populate("job");

    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // 2. Verify ownership: The logged-in user must be the poster of the job
    // We compare strings to avoid ObjectId reference issues
    if (application.job.postedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized: You do not own this job" });
    }

    // 3. Update status
    application.status = status;
    await application.save();

    return res.json({ success: true, application });
  } catch (err) {
    console.error("updateApplicationStatus error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}



// 🔓 Reveal Tutor Contact
// export async function revealTutorContact(req, res) {
//   try {
//     const { applicationId } = req.params;

//     const application = await JobApplication.findById(applicationId)
//       .populate("institution");

//     if (!application) {
//       return res.status(404).json({ message: "Application not found" });
//     }

//     const institution = await Institution.findById(application.institution);

//     // Already revealed
//     if (application.contactRevealed) {
//       return res.json({
//         success: true,
//         message: "Contact already revealed",
//       });
//     }

//     // Check credits
//     if (institution.credits < 1) {
//       return res.status(402).json({
//         message: "Insufficient credits",
//       });
//     }

//     // Deduct credit
//     institution.credits -= 1;
//     await institution.save();

//     // Update application
//     application.contactRevealed = true;
//     application.contactRevealedAt = new Date();
//     application.revealedBy = institution._id;
//     await application.save();

//     // Create transaction
//     await Transaction.create({
//       institution: institution._id,
//       type: "CREDIT_DEBIT",
//       credits: -1,
//       reason: "Reveal tutor contact",
//       referenceId: application._id,
//     });

//     return res.json({
//       success: true,
//       message: "Contact revealed successfully",
//     });

//   } catch (err) {
//     console.error("revealTutorContact error:", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// }
